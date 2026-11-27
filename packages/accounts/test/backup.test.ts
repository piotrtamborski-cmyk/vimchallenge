import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { backup } from '../src/backup.ts';
import { Accounts, openDatabase } from '../src/index.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('backup', () => {
  it('copies the database while it is open, and prunes old copies', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vc-backup-'));
    dirs.push(dir);
    const path = join(dir, 'app.db');
    const accounts = new Accounts(openDatabase(path));
    const user = accounts.signIn({ provider: 'github', subject: '1', login: 'ada' });
    if (!user.ok) throw new Error('sign-in failed');

    const old = join(dir, 'copies', 'vimchallenge-20200101T000000Z.db');
    backup(path, join(dir, 'copies'), 14, new Date('2020-01-01T00:00:00Z'));
    utimesSync(old, new Date('2020-01-01'), new Date('2020-01-01'));
    writeFileSync(join(dir, 'copies', 'notes.txt'), 'kept');

    const copy = backup(path, join(dir, 'copies'));
    expect(readdirSync(join(dir, 'copies')).sort()).toEqual([copy.split('/').at(-1), 'notes.txt'].sort());
    expect(new Accounts(openDatabase(copy)).user(user.user.id)?.name).toBe('ada');
  });
});

describe('backup script', () => {
  it('runs when started through a symlink, as the timer starts it through ~/current', async () => {
    const { execFileSync } = await import('node:child_process');
    const { symlinkSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const dir = mkdtempSync(join(tmpdir(), 'vc-backup-'));
    dirs.push(dir);
    const path = join(dir, 'app.db');
    openDatabase(path).close();
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    symlinkSync(root, join(dir, 'current'));
    const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(dir, 'current/packages/accounts/src/backup.ts'), path, join(dir, 'copies')], {
      encoding: 'utf8',
    });
    expect(out).toMatch(/^backup .*vimchallenge-\d{8}T\d{6}Z\.db\n$/);
    expect(readdirSync(join(dir, 'copies'))).toHaveLength(1);
  });
});
