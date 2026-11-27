/** Opening a database written by a newer release: what a rollback meets. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, SCHEMA_VERSION, schemaOf } from '../src/db.ts';
import { fits, releaseSchema } from '../src/schema.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const file = () => {
  const d = mkdtempSync(join(tmpdir(), 'vc-schema-'));
  dirs.push(d);
  return join(d, 'accounts.db');
};

describe('schema readers', () => {
  it('records that every release can use the current schema', () => {
    expect(schemaOf(openDatabase(':memory:'))).toEqual({ version: SCHEMA_VERSION, oldestReader: 1 });
  });

  it('adds the record to a database of schema 3', () => {
    const path = file();
    const db = openDatabase(path);
    db.exec('DROP TABLE schema_readers; PRAGMA user_version = 3');
    db.close();
    expect(schemaOf(openDatabase(path))).toEqual({ version: SCHEMA_VERSION, oldestReader: 1 });
  });

  it('opens a newer database that releases of this schema can still use', () => {
    const path = file();
    const db = openDatabase(path);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 2}; UPDATE schema_readers SET oldest = ${SCHEMA_VERSION}`);
    db.close();
    const again = openDatabase(path);
    expect(schemaOf(again).version).toBe(SCHEMA_VERSION + 2);
  });

  it('refuses a newer database that needs a newer release', () => {
    const path = file();
    const db = openDatabase(path);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 2}; UPDATE schema_readers SET oldest = ${SCHEMA_VERSION + 1}`);
    db.close();
    expect(() => openDatabase(path)).toThrow(/releases before schema 5 cannot use/);
  });
});

describe('fits', () => {
  it('lets any release open a database of its schema or older', () => {
    expect(fits({ version: 3, oldestReader: 3 }, { version: 3, readsNewer: false })).toBe(true);
    expect(fits({ version: 2, oldestReader: 2 }, { version: 4, readsNewer: true })).toBe(true);
  });
  it('lets an older release open a newer database only when it reads newer schemas and is new enough', () => {
    expect(fits({ version: 6, oldestReader: 4 }, { version: 4, readsNewer: true })).toBe(true);
    expect(fits({ version: 6, oldestReader: 5 }, { version: 4, readsNewer: true })).toBe(false);
    expect(fits({ version: 4, oldestReader: 1 }, { version: 3, readsNewer: false })).toBe(false);
  });
  it('reads the schema of a release from its files', async () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    expect(await releaseSchema(root)).toEqual({ version: SCHEMA_VERSION, readsNewer: true });
  });
});
