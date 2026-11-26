/**
 * Accounts without passwords: a player signs in with an email link, GitHub or Google, and may
 * connect more of them to the same account. Sessions, sign-in links and OAuth state are random
 * tokens of which only hashes are stored. Solves keep the outcome, never the keys.
 */
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './db.ts';
import { nameFrom, randomName, validName, variant } from './names.ts';
import { hashToken, randomToken } from './tokens.ts';

export type Provider = 'email' | 'github' | 'google';
export const PROVIDERS: readonly Provider[] = ['email', 'github', 'google'];

export interface User {
  id: string;
  name: string;
  createdAt: number;
}

export interface Identity {
  provider: Provider;
  subject: string;
  email: string | null;
  createdAt: number;
  usedAt: number;
}

/** Who a provider says signed in. `email` only when the provider verified it. */
export interface VerifiedIdentity {
  provider: Provider;
  subject: string;
  email?: string | null;
  /** The provider's user name (GitHub login), offered as the name of a new account. */
  login?: string;
}

export type SignInResult =
  | { ok: true; user: User; created: boolean; linked: boolean }
  /** No account has this identity, but one has its email address: sign in there and connect it. */
  | { ok: false; error: 'email-in-use'; methods: Provider[] }
  /** The identity belongs to another account and cannot be connected to this one. */
  | { ok: false; error: 'linked-elsewhere' };

export interface Solve {
  taskId: string;
  text: number;
  taskVersion: number;
  judgeVersion: number;
  keys: number;
  solvedAt: number;
}

export interface TaskProgress {
  taskId: string;
  solves: number;
  /** Fewest keys over all its texts. */
  best: number;
  /** Distinct texts solved. */
  texts: number;
  lastAt: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A session ends after 30 days without a visit, and after 180 days in any case. */
export const SESSION_IDLE_MS = 30 * DAY;
export const SESSION_MAX_MS = 180 * DAY;
export const EMAIL_LINK_MS = 15 * 60_000;
export const OAUTH_FLOW_MS = 10 * 60_000;

type Row = Record<string, unknown>;

export class Accounts {
  readonly db: DatabaseSync;
  private readonly now: () => number;

  constructor(db: DatabaseSync, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  // Users and identities

  user(id: string): User | undefined {
    const row = this.db.prepare('SELECT id, name, created_at FROM users WHERE id = ?').get(id);
    return row && toUser(row);
  }

  identities(userId: string): Identity[] {
    return this.db
      .prepare('SELECT provider, subject, email, created_at, used_at FROM identities WHERE user_id = ? ORDER BY created_at')
      .all(userId)
      .map((r) => ({
        provider: r.provider as Provider,
        subject: String(r.subject),
        email: (r.email as string | null) ?? null,
        createdAt: Number(r.created_at),
        usedAt: Number(r.used_at),
      }));
  }

  /**
   * Signs in with an identity a provider verified, creating the account on first use; with
   * `linkTo`, connects the identity to that (signed-in) account instead.
   *
   * A new identity whose email address another account already uses does not create a second
   * account: the owner signs in the way they did before and connects it from there.
   */
  signIn(identity: VerifiedIdentity, linkTo?: string): SignInResult {
    const now = this.now();
    const email = identity.email?.toLowerCase() ?? null;
    return transaction(this.db, () => {
      const existing = this.db
        .prepare('SELECT user_id FROM identities WHERE provider = ? AND subject = ?')
        .get(identity.provider, identity.subject);
      const owner = existing && String(existing.user_id);

      if (owner) {
        if (linkTo && owner !== linkTo) return { ok: false, error: 'linked-elsewhere' } as const;
        this.db
          .prepare('UPDATE identities SET used_at = ?, email = coalesce(?, email) WHERE provider = ? AND subject = ?')
          .run(now, email, identity.provider, identity.subject);
        return { ok: true, user: this.user(owner)!, created: false, linked: false } as const;
      }

      if (linkTo) {
        const user = this.user(linkTo);
        if (!user) throw new Error('no such account to connect to');
        this.insertIdentity(linkTo, identity, email, now);
        return { ok: true, user, created: false, linked: true } as const;
      }

      if (email) {
        const other = this.db.prepare('SELECT user_id FROM identities WHERE email = ? LIMIT 1').get(email);
        if (other) {
          const methods = this.identities(String(other.user_id)).map((i) => i.provider);
          return { ok: false, error: 'email-in-use', methods: [...new Set(methods)] } as const;
        }
      }

      const user: User = { id: randomToken(12), name: this.freeName(nameFrom(identity.login)), createdAt: now };
      this.db.prepare('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)').run(user.id, user.name, now);
      this.insertIdentity(user.id, identity, email, now);
      return { ok: true, user, created: true, linked: false } as const;
    });
  }

  /** Disconnects a sign-in method; the last one stays (delete the account instead). */
  unlink(userId: string, provider: Provider, subject: string): 'ok' | 'last' | 'missing' {
    return transaction(this.db, () => {
      const count = Number(this.db.prepare('SELECT count(*) AS n FROM identities WHERE user_id = ?').get(userId)!.n);
      const found = this.db
        .prepare('SELECT 1 FROM identities WHERE user_id = ? AND provider = ? AND subject = ?')
        .get(userId, provider, subject);
      if (!found) return 'missing';
      if (count <= 1) return 'last';
      this.db.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ? AND subject = ?').run(userId, provider, subject);
      return 'ok';
    });
  }

  rename(userId: string, name: string): 'ok' | 'invalid' | 'taken' {
    if (!validName(name)) return 'invalid';
    const taken = this.db.prepare('SELECT id FROM users WHERE name = ?').get(name);
    if (taken && taken.id !== userId) return 'taken';
    this.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId);
    return 'ok';
  }

  /** Deletes the account with its sign-in methods, sessions and progress. */
  deleteUser(userId: string): void {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  }

  // Sessions

  /** A new session for the account; the returned token goes into the cookie. */
  createSession(userId: string): string {
    const now = this.now();
    const token = randomToken();
    this.db.prepare('DELETE FROM sessions WHERE seen_at < ? OR created_at < ?').run(now - SESSION_IDLE_MS, now - SESSION_MAX_MS);
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, seen_at) VALUES (?, ?, ?, ?)').run(hashToken(token), userId, now, now);
    return token;
  }

  /** The signed-in account for a session token, if the session is still valid. */
  sessionUser(token: string | undefined): User | undefined {
    if (!token) return undefined;
    const now = this.now();
    const hash = hashToken(token);
    const row = this.db
      .prepare('SELECT u.id, u.name, u.created_at, s.created_at AS since, s.seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
      .get(hash);
    if (!row) return undefined;
    if (Number(row.seen_at) < now - SESSION_IDLE_MS || Number(row.since) < now - SESSION_MAX_MS) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      return undefined;
    }
    // One write an hour at most per session, not one per page.
    if (Number(row.seen_at) < now - HOUR) this.db.prepare('UPDATE sessions SET seen_at = ? WHERE token_hash = ?').run(now, hash);
    return toUser(row);
  }

  endSession(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  /** Signs the account out everywhere except the session with `keep`. Returns how many ended. */
  endOtherSessions(userId: string, keep: string | undefined): number {
    return Number(
      this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, keep ? hashToken(keep) : '').changes,
    );
  }

  sessionCount(userId: string): number {
    return Number(this.db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id = ?').get(userId)!.n);
  }

  // Sign-in links by email

  /** A one-time link token for `email` (already normalised); `linkTo` adds the address to that account. */
  createEmailLink(email: string, options: { linkTo?: string; returnTo: string }): string {
    const now = this.now();
    const token = randomToken();
    this.db.prepare('DELETE FROM email_links WHERE created_at < ?').run(now - DAY);
    this.db
      .prepare('INSERT INTO email_links (token_hash, email, link_to, return_to, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(hashToken(token), email, options.linkTo ?? null, options.returnTo, now, now + EMAIL_LINK_MS);
    return token;
  }

  /** Links sent to an address in the last `ms`, for a limit per address that survives restarts. */
  emailLinksWithin(email: string, ms: number): number {
    return Number(this.db.prepare('SELECT count(*) AS n FROM email_links WHERE email = ? AND created_at > ?').get(email, this.now() - ms)!.n);
  }

  /** What a link would do, without using it up (the page asks the player to confirm first). */
  peekEmailLink(token: string): { email: string; linkTo: string | null; returnTo: string } | undefined {
    const row = this.db
      .prepare('SELECT email, link_to, return_to FROM email_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
      .get(hashToken(token), this.now());
    return row && { email: String(row.email), linkTo: (row.link_to as string | null) ?? null, returnTo: String(row.return_to) };
  }

  /** Uses a link up; a second use, or one after 15 minutes, gets nothing. */
  useEmailLink(token: string): { email: string; linkTo: string | null; returnTo: string } | undefined {
    const now = this.now();
    const row = this.db
      .prepare('UPDATE email_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email, link_to, return_to')
      .get(now, hashToken(token), now);
    return row && { email: String(row.email), linkTo: (row.link_to as string | null) ?? null, returnTo: String(row.return_to) };
  }

  // OAuth sign-ins in progress

  /** Remembers a sign-in that went to a provider; the state goes to the provider and into a cookie. */
  startOAuth(provider: Provider, options: { linkTo?: string; returnTo: string }): { state: string; verifier: string; nonce: string } {
    const now = this.now();
    const flow = { state: randomToken(), verifier: randomToken(), nonce: randomToken(16) };
    this.db.prepare('DELETE FROM oauth_flows WHERE expires_at <= ?').run(now);
    this.db
      .prepare('INSERT INTO oauth_flows (state_hash, provider, verifier, nonce, link_to, return_to, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(hashToken(flow.state), provider, flow.verifier, flow.nonce, options.linkTo ?? null, options.returnTo, now + OAUTH_FLOW_MS);
    return flow;
  }

  /** Takes the sign-in back when the provider returns; each state works once. */
  finishOAuth(provider: Provider, state: string): { verifier: string; nonce: string; linkTo: string | null; returnTo: string } | undefined {
    const row = this.db
      .prepare('DELETE FROM oauth_flows WHERE state_hash = ? AND provider = ? AND expires_at > ? RETURNING verifier, nonce, link_to, return_to')
      .get(hashToken(state), provider, this.now());
    return (
      row && {
        verifier: String(row.verifier),
        nonce: String(row.nonce),
        linkTo: (row.link_to as string | null) ?? null,
        returnTo: String(row.return_to),
      }
    );
  }

  // Progress

  recordSolve(userId: string, solve: Omit<Solve, 'solvedAt'>): void {
    this.db
      .prepare('INSERT INTO solves (user_id, task_id, text, task_version, judge_version, keys, solved_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, solve.taskId, solve.text, solve.taskVersion, solve.judgeVersion, solve.keys, this.now());
  }

  /** Per task: how often, how well and how recently the player solved it. */
  progress(userId: string): Map<string, TaskProgress> {
    const rows = this.db
      .prepare(
        'SELECT task_id, count(*) AS solves, min(keys) AS best, count(DISTINCT text) AS texts, max(solved_at) AS last_at FROM solves WHERE user_id = ? GROUP BY task_id',
      )
      .all(userId);
    return new Map(
      rows.map((r) => [
        String(r.task_id),
        { taskId: String(r.task_id), solves: Number(r.solves), best: Number(r.best), texts: Number(r.texts), lastAt: Number(r.last_at) },
      ]),
    );
  }

  /** The newest solves first. */
  history(userId: string, limit = 50): Solve[] {
    return this.db
      .prepare('SELECT task_id, text, task_version, judge_version, keys, solved_at FROM solves WHERE user_id = ? ORDER BY solved_at DESC, rowid DESC LIMIT ?')
      .all(userId, limit)
      .map((r) => ({
        taskId: String(r.task_id),
        text: Number(r.text),
        taskVersion: Number(r.task_version),
        judgeVersion: Number(r.judge_version),
        keys: Number(r.keys),
        solvedAt: Number(r.solved_at),
      }));
  }

  private insertIdentity(userId: string, identity: VerifiedIdentity, email: string | null, now: number) {
    this.db
      .prepare('INSERT INTO identities (provider, subject, user_id, email, created_at, used_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(identity.provider, identity.subject, userId, email, now, now);
  }

  /** `wanted` if free, else a variant of it; a random name when there is nothing to go on. */
  private freeName(wanted: string | undefined): string {
    const taken = this.db.prepare('SELECT 1 FROM users WHERE name = ?');
    let name = wanted ?? randomName();
    for (let i = 0; taken.get(name); i++) name = i < 5 && wanted ? variant(wanted) : `${randomName()}${i > 10 ? i : ''}`;
    return name;
  }
}

const toUser = (r: Row): User => ({ id: String(r.id), name: String(r.name), createdAt: Number(r.created_at) });
