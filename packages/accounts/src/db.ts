/**
 * The accounts database: one SQLite file next to the web app, opened with Node's built-in driver.
 * Migrations are numbered by `PRAGMA user_version` and run once, in order, when the file is opened.
 *
 * A release rolled back to after an update meets a database with migrations it does not know.
 * Each migration therefore says, in `READERS`, the oldest schema a release may know and still use
 * the database after it: an added table or nullable column leaves older releases working, a
 * changed, renamed or dropped one does not. The database keeps the highest of these in
 * `schema_readers`, and a release opens a newer database when its own schema is at least that.
 */
import type { DatabaseSync } from 'node:sqlite';

// Loaded at run time, not imported: bundlers (Next.js) do not all know the `node:sqlite` builtin.
const sqlite = process.getBuiltinModule('node:sqlite');

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    -- Shown to other players later (rooms, leaderboards); unique regardless of case.
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at INTEGER NOT NULL
  ) STRICT;

  -- A way to sign in: an email address, or an account at GitHub or Google.
  CREATE TABLE identities (
    provider TEXT NOT NULL CHECK (provider IN ('email', 'github', 'google')),
    -- The address for 'email'; the provider's stable user id otherwise.
    subject TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- Verified address the provider reported, lower case; used to spot a second account.
    email TEXT,
    created_at INTEGER NOT NULL,
    used_at INTEGER NOT NULL,
    PRIMARY KEY (provider, subject)
  ) STRICT;
  CREATE INDEX identities_user ON identities (user_id);
  CREATE INDEX identities_email ON identities (email);

  -- The cookie holds the token; only its hash is stored.
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX sessions_user ON sessions (user_id);

  -- Sign-in links sent by email: one use, a short life.
  CREATE TABLE email_links (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    -- Set when a signed-in player adds the address to their account.
    link_to TEXT REFERENCES users (id) ON DELETE CASCADE,
    return_to TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  ) STRICT;
  CREATE INDEX email_links_email ON email_links (email, created_at);

  -- OAuth sign-ins in progress, by the hash of their state parameter.
  CREATE TABLE oauth_flows (
    state_hash TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    verifier TEXT NOT NULL,
    nonce TEXT NOT NULL,
    link_to TEXT REFERENCES users (id) ON DELETE CASCADE,
    return_to TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT;

  -- Solves the judge confirmed: the outcome only, never the keys.
  CREATE TABLE solves (
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    text INTEGER NOT NULL,
    task_version INTEGER NOT NULL,
    judge_version INTEGER NOT NULL,
    keys INTEGER NOT NULL,
    solved_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX solves_user ON solves (user_id, solved_at);
  `,
  // 2: live rooms (packages/rooms). A room is deleted, with everything below it, a week after its
  // last activity.
  `
  CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    -- The invite code in /rooms/{code}.
    code TEXT NOT NULL UNIQUE,
    -- Player id of the host: 'u:' and an account id, or 'g:' and a guest id.
    host TEXT NOT NULL,
    rounds INTEGER NOT NULL,
    -- '1' to '5', or 'mixed' for rising levels.
    level TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    touched_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX rooms_touched ON rooms (touched_at);

  CREATE TABLE room_members (
    room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    player TEXT NOT NULL,
    user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
    name TEXT NOT NULL COLLATE NOCASE,
    ready INTEGER NOT NULL DEFAULT 0,
    joined_at INTEGER NOT NULL,
    seen_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, player),
    UNIQUE (room_id, name)
  ) STRICT;

  -- One game in a room: its players and rounds are fixed when it starts.
  CREATE TABLE matches (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    scoring INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    UNIQUE (room_id, number)
  ) STRICT;

  CREATE TABLE match_players (
    match_id TEXT NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
    player TEXT NOT NULL,
    user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (match_id, player)
  ) STRICT;

  CREATE TABLE rounds (
    match_id TEXT NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    task_id TEXT NOT NULL,
    task_version INTEGER NOT NULL,
    text INTEGER NOT NULL,
    level INTEGER NOT NULL,
    reference_ms INTEGER NOT NULL,
    -- Set when the round before has ended (for the first, when the match starts).
    starts_at INTEGER,
    deadline INTEGER,
    ended_at INTEGER,
    PRIMARY KEY (match_id, number)
  ) STRICT;

  -- One player's go at one round. Keys arrive in packets; a check that waits for the judge keeps
  -- the time it was received, so a busy judge costs the player nothing.
  CREATE TABLE attempts (
    match_id TEXT NOT NULL,
    round INTEGER NOT NULL,
    player TEXT NOT NULL,
    keys TEXT NOT NULL DEFAULT '[]',
    key_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'solved', 'skipped', 'timeout')),
    submitted_count INTEGER,
    submitted_at INTEGER,
    checks INTEGER NOT NULL DEFAULT 0,
    -- When the attempt closed, and for a solve the time from the round's start and its points.
    resolved_at INTEGER,
    ms INTEGER,
    base INTEGER NOT NULL DEFAULT 0,
    bonus INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (match_id, round, player),
    FOREIGN KEY (match_id, round) REFERENCES rounds (match_id, number) ON DELETE CASCADE
  ) STRICT;
  `,
  // 3: the daily challenge and the leaderboards (packages/daily).
  `
  -- Whether the player's name may appear on the public leaderboards: NULL until they choose.
  ALTER TABLE users ADD COLUMN on_boards INTEGER;

  -- One official set a day (UTC), the same for everyone.
  CREATE TABLE daily_sets (
    day TEXT PRIMARY KEY,
    -- Versions of the points per task and of the league points per day.
    scoring INTEGER NOT NULL,
    league INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    -- When the last run that could start on this day was over: its entries are final.
    settled_at INTEGER,
    -- Every task of the day was voided: the day counts for no one.
    cancelled_at INTEGER
  ) STRICT;

  CREATE TABLE daily_tasks (
    day TEXT NOT NULL REFERENCES daily_sets (day) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    task_id TEXT NOT NULL,
    task_version INTEGER NOT NULL,
    text INTEGER NOT NULL,
    level INTEGER NOT NULL,
    base INTEGER NOT NULL,
    reference_ms INTEGER NOT NULL,
    available_ms INTEGER NOT NULL,
    -- A faulty task, taken out of the day for everyone (daily_corrections says why).
    voided_at INTEGER,
    PRIMARY KEY (day, position)
  ) STRICT;

  -- An account's one scored go at a day's set. It belongs to the day it started on.
  CREATE TABLE daily_runs (
    day TEXT NOT NULL REFERENCES daily_sets (day) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    -- The start plus the time of every task of the set: the latest the run can go on.
    ends_at INTEGER NOT NULL,
    finished_at INTEGER,
    PRIMARY KEY (day, user_id)
  ) STRICT;
  CREATE INDEX daily_runs_user ON daily_runs (user_id, day);

  -- One task of a run, from the moment it was given. Like a round's attempt in a room.
  CREATE TABLE daily_attempts (
    day TEXT NOT NULL,
    user_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    starts_at INTEGER NOT NULL,
    deadline INTEGER NOT NULL,
    -- Deleted a week after the day is settled; the count stays.
    keys TEXT NOT NULL DEFAULT '[]',
    key_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'solved', 'skipped', 'timeout')),
    submitted_count INTEGER,
    submitted_at INTEGER,
    checks INTEGER NOT NULL DEFAULT 0,
    resolved_at INTEGER,
    ms INTEGER,
    base INTEGER NOT NULL DEFAULT 0,
    bonus INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, user_id, position),
    FOREIGN KEY (day, user_id) REFERENCES daily_runs (day, user_id) ON DELETE CASCADE,
    FOREIGN KEY (day, position) REFERENCES daily_tasks (day, position) ON DELETE CASCADE
  ) STRICT;

  -- A run's result, rebuilt from its attempts and the tasks of the day that count. The weekly,
  -- monthly and all-time tables are sums of these.
  CREATE TABLE daily_entries (
    day TEXT NOT NULL,
    user_id TEXT NOT NULL,
    points INTEGER NOT NULL,
    solves INTEGER NOT NULL,
    seconds INTEGER NOT NULL,
    -- The most the tasks that count could give: what the league points are relative to.
    max_points INTEGER NOT NULL,
    league INTEGER NOT NULL,
    PRIMARY KEY (day, user_id),
    FOREIGN KEY (day, user_id) REFERENCES daily_runs (day, user_id) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX daily_entries_user ON daily_entries (user_id, day);

  -- Tasks voided or restored after the fact, with the day's entries as they were before.
  CREATE TABLE daily_corrections (
    id INTEGER PRIMARY KEY,
    day TEXT NOT NULL REFERENCES daily_sets (day) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('void', 'restore')),
    reason TEXT NOT NULL,
    at INTEGER NOT NULL,
    -- JSON: [{ user, points, league }] before the correction.
    before TEXT NOT NULL
  ) STRICT;
  `,
  // 4: which releases can use this database (see the top of this file).
  `
  CREATE TABLE schema_readers (oldest INTEGER NOT NULL) STRICT;
  INSERT INTO schema_readers (oldest) VALUES (1);
  `,
];

/**
 * For each migration, the oldest schema a release may know and still use the database after it.
 * 1 to 4 only add tables and a nullable column, so a release of any schema can use the result.
 */
const READERS: readonly number[] = [1, 1, 1, 1];
if (READERS.length !== MIGRATIONS.length) throw new Error('every migration needs its entry in READERS');

/** The migration that made `schema_readers`. */
const READERS_TABLE_SINCE = 4;

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Marks releases that open a newer database when its `schema_readers` allows; older ones never do. */
export const READS_NEWER_SCHEMAS = true;

/** The database's schema and the oldest schema a release may know to use it. */
export function schemaOf(db: DatabaseSync): { version: number; oldestReader: number } {
  const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  const hasReaders = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_readers'").get();
  // Before migration 4 nothing was recorded: then only a release of that very schema or newer fits.
  const oldestReader = hasReaders ? Number((db.prepare('SELECT max(oldest) AS o FROM schema_readers').get() as { o: number }).o) : version;
  return { version, oldestReader };
}

/** Opens (and creates or migrates) the database at `path`; `:memory:` for tests. */
export function openDatabase(path: string): DatabaseSync {
  const db = new sqlite.DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (path !== ':memory:') {
    // Readers (a backup) never block the app, and the app never waits for a full sync per write.
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync) {
  const { version: current, oldestReader } = schemaOf(db);
  if (current > MIGRATIONS.length) {
    if (oldestReader <= MIGRATIONS.length) return;
    throw new Error(
      `the database has schema ${current}, which releases before schema ${oldestReader} cannot use; this release has ${MIGRATIONS.length}. ` +
        'Run a newer release, or restore the copy made before the update (deploy/README.md, "Rolling back").',
    );
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[v]!);
      if (v + 1 >= READERS_TABLE_SINCE) db.prepare('UPDATE schema_readers SET oldest = max(oldest, ?)').run(READERS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Runs `fn` in one write transaction. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
