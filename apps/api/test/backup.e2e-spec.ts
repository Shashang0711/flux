import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { FILE_STORAGE, LocalFileStorage, type FileStorage } from '../src/modules/files/storage';
import {
  createBackup,
  pgToolsFromEnv,
  restoreBackup,
  verifyBackup,
  type PgTools,
} from '../src/ops/backup';
import { createE2eApp, createTenant, createUser, loginCookie, resetDatabase } from './e2e-app';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');

/**
 * pg_dump/pg_restore of the server's major version: PG_DUMP_COMMAND / PG_RESTORE_COMMAND if
 * set, else local tools if they match, else the official image through Docker.
 */
function pgTools(serverMajor: number): PgTools {
  if (process.env.PG_DUMP_COMMAND && process.env.PG_RESTORE_COMMAND) return pgToolsFromEnv();
  try {
    const local = execFileSync('pg_dump', ['--version']).toString();
    if (local.includes(`) ${serverMajor}.`)) return pgToolsFromEnv({});
  } catch {
    // No local tools: use Docker.
  }
  const docker = (tool: string) => [
    'docker',
    'run',
    '-i',
    '--rm',
    '--network',
    'host',
    '-e',
    'PGPASSWORD',
    `postgres:${serverMajor}-alpine`,
    tool,
  ];
  return { pgDump: docker('pg_dump'), pgRestore: docker('pg_restore') };
}

describe('Backup and restore (e2e)', () => {
  // pg_dump/pg_restore may run through Docker.
  jest.setTimeout(60_000);
  let app: INestApplication;
  let prisma: PrismaService;
  let tools: PgTools;
  let work: string;
  const restoreUrl = (() => {
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = '/flux_restore_test';
    return url.toString();
  })();
  const admin = () => {
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = '/postgres';
    return new PrismaClient({ datasources: { db: { url: url.toString() } } });
  };

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
    const [row] = await prisma.$queryRaw<{ n: string }[]>`
      SELECT current_setting('server_version_num') AS n`;
    tools = pgTools(Math.floor(Number(row!.n) / 10_000));
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    work = await mkdtemp(join(tmpdir(), 'flux-backup-'));
    const pg = admin();
    await pg.$executeRawUnsafe('DROP DATABASE IF EXISTS flux_restore_test WITH (FORCE)');
    await pg.$executeRawUnsafe('CREATE DATABASE flux_restore_test');
    await pg.$disconnect();
  });

  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  afterAll(async () => {
    const pg = admin();
    await pg.$executeRawUnsafe('DROP DATABASE IF EXISTS flux_restore_test WITH (FORCE)');
    await pg.$disconnect();
    await app.close();
  });

  it('backs up database and files, and restores them into an empty database and storage', async () => {
    const tenant = await createTenant(prisma, { slug: 'acme', modules: ['samples', 'reports'] });
    await createUser(prisma, {
      email: 'ann@acme.test',
      tenantId: tenant.id,
      roleIds: [tenant.adminRoleId],
    });
    const cookie = await loginCookie(app, 'ann@acme.test');
    const intent = (
      await request(app.getHttpServer())
        .post('/api/v1/files')
        .set('Cookie', cookie)
        .send({ purpose: 'LAB_REPORT', name: 'report.pdf', size: PDF.length })
        .expect(201)
    ).body.data;
    await request(app.getHttpServer())
      .put(`/api/v1${intent.uploadPath}`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/octet-stream')
      .send(PDF)
      .expect(200);

    const storage = app.get<FileStorage>(FILE_STORAGE);
    const manifest = await createBackup({
      databaseUrl: process.env.DATABASE_URL!,
      storage,
      outDir: join(work, 'backup'),
      tools,
    });
    expect(manifest).toMatchObject({
      format: 'flux-backup/1',
      warnings: [],
      lastMigration: expect.stringMatching(/^\d{14}_/),
    });
    expect(manifest.tables.tenants).toBe(1);
    expect(manifest.tables.users).toBe(1);
    expect(manifest.files).toEqual([
      expect.objectContaining({ key: `${tenant.id}/${intent.file.id}`, bytes: PDF.length }),
    ]);
    await verifyBackup(join(work, 'backup'));

    // Restore into a fresh database and a fresh storage folder.
    const target = new LocalFileStorage(join(work, 'restored-files'));
    const report = await restoreBackup({
      dir: join(work, 'backup'),
      databaseUrl: restoreUrl,
      storage: target,
      tools,
    });
    expect(report.files).toBe(1);
    const restored = new PrismaClient({ datasources: { db: { url: restoreUrl } } });
    try {
      const users = await restored.user.findMany({ select: { email: true } });
      expect(users).toEqual([{ email: 'ann@acme.test' }]);
      // Row-level security came back with the schema.
      const [rls] = await restored.$queryRaw<{ on: boolean }[]>`
        SELECT relrowsecurity AS on FROM pg_class WHERE relname = 'samples'`;
      expect(rls!.on).toBe(true);
      const file = await restored.storedFile.findFirstOrThrow();
      const chunks: Buffer[] = [];
      for await (const c of await target.get(file.storageKey)) chunks.push(c as Buffer);
      expect(Buffer.concat(chunks).equals(PDF)).toBe(true);
    } finally {
      await restored.$disconnect();
    }

    // A database that is no longer empty is refused.
    await expect(
      restoreBackup({ dir: join(work, 'backup'), databaseUrl: restoreUrl, storage: target, tools }),
    ).rejects.toThrow(/not empty/);
  });

  it('refuses a damaged backup before touching anything', async () => {
    await createTenant(prisma, { slug: 'acme' });
    const dir = join(work, 'backup');
    await createBackup({
      databaseUrl: process.env.DATABASE_URL!,
      storage: app.get<FileStorage>(FILE_STORAGE),
      outDir: dir,
      tools,
    });
    const dump = join(dir, 'database.dump');
    const bytes = await readFile(dump);
    bytes[bytes.length - 10] = bytes[bytes.length - 10]! ^ 0xff;
    await writeFile(dump, bytes);
    await expect(verifyBackup(dir)).rejects.toThrow(/damaged or incomplete: database dump/);
    await expect(
      restoreBackup({
        dir,
        databaseUrl: restoreUrl,
        storage: new LocalFileStorage(join(work, 'x')),
        tools,
      }),
    ).rejects.toThrow(/damaged/);
    // Nothing was restored.
    const restored = new PrismaClient({ datasources: { db: { url: restoreUrl } } });
    const [{ n }] = (await restored.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public'`) as [{ n: bigint }];
    await restored.$disconnect();
    expect(Number(n)).toBe(0);
  });

  it('refuses pg tools of another major version than the server', async () => {
    await expect(
      createBackup({
        databaseUrl: process.env.DATABASE_URL!,
        storage: app.get<FileStorage>(FILE_STORAGE),
        outDir: join(work, 'backup'),
        tools: {
          pgDump: ['node', '-e', 'console.log("pg_dump (PostgreSQL) 9.6")', '--'],
          pgRestore: [],
        },
      }),
    ).rejects.toThrow(/PostgreSQL 9, the server is \d+/);
  });
});
