import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateEnv } from '../config/env';
import { createFileStorage } from '../modules/files/storage';
import { createBackup, listBackups, restoreBackup, verifyBackup } from './backup';

/**
 * Operations CLI (see "Operations" in the README):
 *   backup  [--dir ./backups] [--keep N]   new backup folder; keep only the newest N
 *   verify  <folder>                       check a backup against its manifest
 *   restore <folder> --yes [--database-url URL]
 *                                          restore into an EMPTY database and the configured storage
 * Reads the same environment as the API (DATABASE_URL, STORAGE_*, S3_*).
 */
function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z').replace('T', '-');
}

async function main(argv: string[]): Promise<number> {
  const envFile = join(__dirname, '..', '..', '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const [command, ...args] = argv;
  const env = validateEnv(process.env);
  const storage = () => createFileStorage((key) => env[key]);

  if (command === 'backup') {
    const root = resolve(option(args, '--dir') ?? './backups');
    const out = join(root, `flux-backup-${timestamp()}`);
    const manifest = await createBackup({
      databaseUrl: env.DATABASE_URL,
      storage: await storage(),
      outDir: out,
    });
    const rows = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
    console.log(`Backup written to ${out}`);
    console.log(
      `  ${rows} rows in ${Object.keys(manifest.tables).length} tables, ${manifest.files.length} files`,
    );
    const keep = Number(option(args, '--keep') ?? 0);
    if (keep > 0) {
      for (const old of (await listBackups(root)).slice(keep)) {
        await rm(join(root, old), { recursive: true, force: true });
        console.log(`  removed old backup ${old}`);
      }
    }
    for (const w of manifest.warnings) console.warn(`  WARNING: ${w}`);
    // Non-zero so a scheduler alerts on warnings, although the backup was written.
    return manifest.warnings.length > 0 ? 2 : 0;
  }

  if (command === 'verify') {
    const dir = args[0];
    if (!dir) throw new Error('Usage: verify <backup folder>');
    const manifest = await verifyBackup(resolve(dir));
    console.log(
      `OK: backup of ${manifest.createdAt} (app ${manifest.appVersion}, migration ${manifest.lastMigration}), ${manifest.files.length} files`,
    );
    return 0;
  }

  if (command === 'restore') {
    const dir = args[0];
    if (!dir) throw new Error('Usage: restore <backup folder> --yes [--database-url URL]');
    const manifest = await verifyBackup(resolve(dir));
    const databaseUrl = option(args, '--database-url') ?? env.DATABASE_URL;
    const target = new URL(databaseUrl);
    console.log(`Backup of ${manifest.createdAt} is intact.`);
    console.log(
      `Target: database "${target.pathname.slice(1)}" on ${target.host}, storage ${env.STORAGE_DRIVER}`,
    );
    if (!args.includes('--yes')) {
      console.log('Nothing restored. Add --yes to restore into this (empty) database.');
      return 0;
    }
    const report = await restoreBackup({
      dir: resolve(dir),
      databaseUrl,
      storage: await storage(),
    });
    console.log(
      `Restored and verified: ${report.rows} rows in ${report.tables} tables, ${report.files} files`,
    );
    return 0;
  }

  console.error('Usage: cli <backup|verify|restore> …');
  return 64;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: Error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  },
);
