/**
 * The accounts database: one SQLite file next to the web app, opened with Node's built-in driver.
 * Migrations are numbered by `PRAGMA user_version` and run once, in order, when the file is opened.
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
];

export const SCHEMA_VERSION = MIGRATIONS.length;

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
  const current = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (current > MIGRATIONS.length)
    throw new Error(`the database has schema ${current}, newer than this release (${MIGRATIONS.length}); run a newer release`);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[v]!);
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
