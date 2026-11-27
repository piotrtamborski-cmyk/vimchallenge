/**
 * Whether a release can use the accounts database, before rolling back to it:
 *
 *   node packages/accounts/src/schema.ts <database> [<release directory>]
 *
 * Prints the database's schema and the oldest schema a release may know to use it. With a release
 * directory, also whether that release can open it: exits with 0 when it can, 3 when it cannot (it
 * would stop at start), 2 on wrong use. Reads the database only.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { schemaOf } from './db.ts';

const sqlite = process.getBuiltinModule('node:sqlite');

export interface ReleaseSchema {
  version: number;
  readsNewer: boolean;
}

/** Whether a release of `release` schema can open a database of `db` schema. */
export function fits(db: { version: number; oldestReader: number }, release: ReleaseSchema): boolean {
  if (db.version <= release.version) return true;
  return release.readsNewer && db.oldestReader <= release.version;
}

/** The schema of the release in `dir`, from its own copy of this package. */
export async function releaseSchema(dir: string): Promise<ReleaseSchema> {
  const file = join(dir, 'packages/accounts/src/db.ts');
  if (!existsSync(file)) throw new Error(`${file} does not exist`);
  const m = (await import(pathToFileURL(file).href)) as { SCHEMA_VERSION: number; READS_NEWER_SCHEMAS?: boolean };
  return { version: m.SCHEMA_VERSION, readsNewer: m.READS_NEWER_SCHEMAS === true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [database, release] = process.argv.slice(2);
  if (!database) {
    console.error('usage: node schema.ts <database> [<release directory>]');
    process.exit(2);
  }
  const db = new sqlite.DatabaseSync(database, { readOnly: true });
  const schema = schemaOf(db);
  db.close();
  console.log(
    `database: schema ${schema.version}; an older release can use it if it is of schema ${schema.oldestReader} or later and checks for newer schemas`,
  );
  if (release) {
    const r = await releaseSchema(release);
    const ok = fits(schema, r);
    console.log(`${release}: schema ${r.version}${r.readsNewer ? '' : ', opens no newer schema'}: ${ok ? 'can use the database' : 'cannot use the database'}`);
    process.exit(ok ? 0 : 3);
  }
}
