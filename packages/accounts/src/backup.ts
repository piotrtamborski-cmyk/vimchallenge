/**
 * A consistent copy of the accounts database, made while the app runs:
 *
 *   node packages/accounts/src/backup.ts <database> <directory> [days to keep, default 14]
 *
 * Writes `<directory>/vimchallenge-<UTC time>.db`, checks the copy with `PRAGMA integrity_check`,
 * and deletes copies older than the days to keep. Exits with 1 when the copy fails.
 */
import { chmodSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sqlite = process.getBuiltinModule('node:sqlite');

export function backup(database: string, directory: string, keepDays = 14, now = new Date()): string {
  mkdirSync(directory, { recursive: true, mode: 0o750 });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const target = join(directory, `vimchallenge-${stamp}.db`);
  const partial = `${target}.partial`;
  rmSync(partial, { force: true });

  const source = new sqlite.DatabaseSync(database, { readOnly: true });
  try {
    source.prepare('VACUUM INTO ?').run(partial);
  } finally {
    source.close();
  }
  const copy = new sqlite.DatabaseSync(partial, { readOnly: true });
  try {
    const check = copy.prepare('PRAGMA integrity_check').all();
    if (check.length !== 1 || check[0]!.integrity_check !== 'ok') throw new Error(`the copy is damaged: ${JSON.stringify(check)}`);
  } finally {
    copy.close();
  }
  // The copy holds email addresses: readable by the service user only.
  chmodSync(partial, 0o600);
  renameSync(partial, target);

  const cutoff = now.getTime() - keepDays * 86_400_000;
  for (const name of readdirSync(directory)) {
    if (!/^vimchallenge-\d{8}T\d{6}Z\.db$/.test(name)) continue;
    const path = join(directory, name);
    if (path !== target && statSync(path).mtimeMs < cutoff) rmSync(path);
  }
  return target;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [database, directory, days] = process.argv.slice(2);
  if (!database || !directory) {
    console.error('usage: node backup.ts <database> <directory> [days to keep]');
    process.exit(2);
  }
  try {
    console.log(`backup ${backup(database, directory, days ? Number(days) : undefined)}`);
  } catch (err) {
    console.error(`backup failed: ${(err as Error).message}`);
    process.exit(1);
  }
}
