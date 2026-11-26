import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { PrismaClient } from '@prisma/client';
import { APP_VERSION } from '../common/app-info/app-version';
import type { FileStorage } from '../modules/files/storage';

/**
 * Backup and restore of a FLUX installation: the database (pg_dump, custom format) and every
 * stored file, with a manifest of checksums and row counts. Restore checks the whole backup
 * before touching anything, only restores into an empty database, and verifies the result.
 *
 * pg_dump/pg_restore must have the same major version as the server (a newer pg_restore emits
 * settings an older server rejects). Override the commands with PG_DUMP_COMMAND and
 * PG_RESTORE_COMMAND, e.g. `docker run -i --rm --network host -e PGPASSWORD postgres:16-alpine
 * pg_dump`. Data goes through stdin/stdout and the password through PGPASSWORD, never argv.
 */

export const BACKUP_FORMAT = 'flux-backup/1';

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  createdAt: string;
  appVersion: string;
  postgresVersion: string;
  lastMigration: string | null;
  database: { file: string; bytes: number; sha256: string };
  /** Rows per table, checked again after a restore. */
  tables: Record<string, number>;
  files: { key: string; bytes: number; sha256: string; contentType: string | null }[];
  /** Problems found while backing up (e.g. a stored object missing); the backup still ran. */
  warnings: string[];
}

export interface PgTools {
  pgDump: string[];
  pgRestore: string[];
}

export function pgToolsFromEnv(env: NodeJS.ProcessEnv = process.env): PgTools {
  const split = (v: string | undefined, fallback: string) =>
    (v?.trim() || fallback).split(/\s+/).filter(Boolean);
  return {
    pgDump: split(env.PG_DUMP_COMMAND, 'pg_dump'),
    pgRestore: split(env.PG_RESTORE_COMMAND, 'pg_restore'),
  };
}

/** libpq connection details from a Prisma DATABASE_URL (Prisma-only parameters removed). */
export function libpqConnection(databaseUrl: string): { url: string; password: string } {
  const url = new URL(databaseUrl);
  const password = decodeURIComponent(url.password);
  url.password = '';
  for (const key of [...url.searchParams.keys()]) {
    if (['schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'socket_timeout'].includes(key))
      url.searchParams.delete(key);
  }
  return { url: url.toString(), password };
}

function run(
  command: string[],
  args: string[],
  password: string,
  io: { stdin?: Readable; stdout?: NodeJS.WritableStream } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0]!, [...command.slice(1), ...args], {
      env: { ...process.env, PGPASSWORD: password },
      stdio: [io.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    if (io.stdout) child.stdout!.pipe(io.stdout);
    else child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr!.on('data', (d: Buffer) => (err += d.toString()));
    if (io.stdin) io.stdin.pipe(child.stdin!);
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(`${command.join(' ')} failed (${code}): ${err.trim().slice(0, 2000)}`)),
    );
  });
}

async function serverMajor(prisma: PrismaClient): Promise<{ major: number; version: string }> {
  const [row] = await prisma.$queryRaw<{ v: string; n: string }[]>`
    SELECT current_setting('server_version') AS v, current_setting('server_version_num') AS n`;
  return { major: Math.floor(Number(row!.n) / 10_000), version: row!.v };
}

/** Refuses tools of another major version than the server (see the note at the top). */
async function assertToolMatches(command: string[], server: number): Promise<void> {
  const output = await run(command, ['--version'], '');
  const major = Number(/(\d+)(?:\.\d+)?/.exec(output.replace(/^[^\d]*/, ''))?.[1]);
  if (major !== server) {
    throw new Error(
      `${command.join(' ')} is PostgreSQL ${major}, the server is ${server}. Use tools of the ` +
        `same major version (set PG_DUMP_COMMAND / PG_RESTORE_COMMAND, see the operations guide).`,
    );
  }
}

async function tableCounts(prisma: PrismaClient): Promise<Record<string, number>> {
  const tables = await prisma.$queryRaw<{ name: string }[]>`
    SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`,
    );
    counts[name] = Number(row!.n);
  }
  return counts;
}

async function sha256File(path: string): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return { sha256: hash.digest('hex'), bytes: (await stat(path)).size };
}

async function toBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
}

function client(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

export async function createBackup(options: {
  databaseUrl: string;
  storage: FileStorage;
  /** A new, empty folder is created here. */
  outDir: string;
  tools?: PgTools;
}): Promise<BackupManifest> {
  const tools = options.tools ?? pgToolsFromEnv();
  const prisma = client(options.databaseUrl);
  try {
    const server = await serverMajor(prisma);
    await assertToolMatches(tools.pgDump, server.major);
    await mkdir(dirname(options.outDir), { recursive: true });
    // Never write into an existing folder.
    await mkdir(options.outDir, { recursive: false });

    // Files first, then the database: every file the dump refers to is then already saved
    // (uploads finishing in between are in the dump without a file, and are reported).
    const rows = await prisma.storedFile.findMany({
      where: { status: 'READY' },
      select: { storageKey: true, sha256: true, contentType: true },
      orderBy: { storageKey: 'asc' },
    });
    const warnings: string[] = [];
    const files: BackupManifest['files'] = [];
    for (const row of rows) {
      let body: Buffer;
      try {
        body = await toBuffer(await options.storage.get(row.storageKey));
      } catch {
        warnings.push(`Stored object missing: ${row.storageKey}`);
        continue;
      }
      const sha256 = createHash('sha256').update(body).digest('hex');
      if (row.sha256 && row.sha256 !== sha256) {
        warnings.push(`Stored object does not match its checksum: ${row.storageKey}`);
      }
      const target = join(options.outDir, 'files', row.storageKey);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body, { mode: 0o600 });
      files.push({ key: row.storageKey, bytes: body.length, sha256, contentType: row.contentType });
    }

    const { url, password } = libpqConnection(options.databaseUrl);
    const dumpPath = join(options.outDir, 'database.dump');
    const out = createWriteStream(dumpPath, { mode: 0o600 });
    // One consistent snapshot of the whole database.
    await run(tools.pgDump, ['--format=custom', '--no-owner', `--dbname=${url}`], password, {
      stdout: out,
    });
    await new Promise<void>((resolve, reject) => {
      if (out.writableFinished) resolve();
      else out.on('finish', resolve).on('error', reject);
    });

    const migrations = await prisma.$queryRaw<{ name: string }[]>`
      SELECT migration_name AS name FROM _prisma_migrations
       WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1`;
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      createdAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      postgresVersion: server.version,
      lastMigration: migrations[0]?.name ?? null,
      database: { file: 'database.dump', ...(await sha256File(dumpPath)) },
      tables: await tableCounts(prisma),
      files,
      warnings,
    };
    await writeFile(join(options.outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    return manifest;
  } finally {
    await prisma.$disconnect();
  }
}

/** Checks a backup folder against its manifest (format, database dump and every file). */
export async function verifyBackup(dir: string): Promise<BackupManifest> {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as BackupManifest;
  if (manifest.format !== BACKUP_FORMAT)
    throw new Error(`Unknown backup format: ${manifest.format}`);
  const problems: string[] = [];
  const dump = await sha256File(join(dir, manifest.database.file)).catch(() => null);
  if (!dump || dump.sha256 !== manifest.database.sha256) problems.push('database dump');
  for (const file of manifest.files) {
    const actual = await sha256File(join(dir, 'files', file.key)).catch(() => null);
    if (!actual || actual.sha256 !== file.sha256) problems.push(`file ${file.key}`);
  }
  if (problems.length > 0) {
    throw new Error(`Backup is damaged or incomplete: ${problems.slice(0, 20).join(', ')}`);
  }
  return manifest;
}

export interface RestoreReport {
  tables: number;
  rows: number;
  files: number;
}

/**
 * Restores a verified backup into an EMPTY database and the given storage, then checks row
 * counts and file checksums. To replace an installation, create a fresh database first.
 */
export async function restoreBackup(options: {
  dir: string;
  databaseUrl: string;
  storage: FileStorage;
  tools?: PgTools;
}): Promise<RestoreReport> {
  const tools = options.tools ?? pgToolsFromEnv();
  const manifest = await verifyBackup(options.dir);
  const prisma = client(options.databaseUrl);
  try {
    const server = await serverMajor(prisma);
    await assertToolMatches(tools.pgRestore, server.major);
    const [{ n }] = (await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public'`) as [{ n: bigint }];
    if (Number(n) > 0) {
      throw new Error('The target database is not empty. Restore into a newly created database.');
    }
    // Roles are cluster-wide, so not in the dump: the app role the grants refer to.
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flux_app') THEN
        CREATE ROLE flux_app NOLOGIN;
      END IF;
    END $$`);
    await prisma.$executeRawUnsafe('GRANT flux_app TO CURRENT_USER');

    const { url, password } = libpqConnection(options.databaseUrl);
    await run(
      tools.pgRestore,
      ['--no-owner', '--exit-on-error', '--single-transaction', `--dbname=${url}`],
      password,
      { stdin: createReadStream(join(options.dir, manifest.database.file)) },
    );

    for (const file of manifest.files) {
      const body = await readFile(join(options.dir, 'files', file.key));
      await options.storage.put(file.key, body, file.contentType ?? 'application/octet-stream');
    }

    // Verify: same rows per table, every file readable with the same checksum.
    const counts = await tableCounts(prisma);
    const wrong = Object.entries(manifest.tables).filter(([t, c]) => counts[t] !== c);
    if (wrong.length > 0) {
      throw new Error(`Row counts differ after restore: ${wrong.map(([t]) => t).join(', ')}`);
    }
    for (const file of manifest.files) {
      const body = await toBuffer(await options.storage.get(file.key));
      if (createHash('sha256').update(body).digest('hex') !== file.sha256) {
        throw new Error(`Restored file does not match: ${file.key}`);
      }
    }
    return {
      tables: Object.keys(counts).length,
      rows: Object.values(counts).reduce((a, b) => a + b, 0),
      files: manifest.files.length,
    };
  } finally {
    await prisma.$disconnect();
  }
}

/** Backups in a folder, newest first (names are timestamps). */
export async function listBackups(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith('flux-backup-'))
    .map((e) => e.name)
    .sort()
    .reverse();
}
