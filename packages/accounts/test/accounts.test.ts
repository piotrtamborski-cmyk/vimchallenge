import { describe, expect, it } from 'vitest';
import { Accounts, EMAIL_LINK_MS, openDatabase, SESSION_IDLE_MS, SESSION_MAX_MS, type SignInResult } from '../src/index.ts';

function setup() {
  let now = 1_800_000_000_000;
  const clock = { advance: (ms: number) => (now += ms) };
  const accounts = new Accounts(openDatabase(':memory:'), () => now);
  return { accounts, clock };
}

const ok = (r: SignInResult) => {
  if (!r.ok) throw new Error(`sign-in failed: ${r.error}`);
  return r;
};

describe('signing in', () => {
  it('creates an account on first use and finds it again', () => {
    const { accounts } = setup();
    const first = ok(accounts.signIn({ provider: 'github', subject: '42', email: 'Ada@Example.com', login: 'ada' }));
    expect(first).toMatchObject({ created: true, user: { name: 'ada' } });
    const again = ok(accounts.signIn({ provider: 'github', subject: '42', email: 'ada@example.com' }));
    expect(again).toMatchObject({ created: false, user: { id: first.user.id } });
    expect(accounts.identities(first.user.id)).toMatchObject([{ provider: 'github', subject: '42', email: 'ada@example.com' }]);
  });

  it('names accounts without a login, and keeps names unique', () => {
    const { accounts } = setup();
    const a = ok(accounts.signIn({ provider: 'email', subject: 'a@example.com', email: 'a@example.com' }));
    expect(a.user.name).toMatch(/^vimmer-\d{4}$/);
    const b = ok(accounts.signIn({ provider: 'github', subject: '1', login: 'Ada' }));
    const c = ok(accounts.signIn({ provider: 'github', subject: '2', login: 'ada' }));
    expect(b.user.name).toBe('Ada');
    expect(c.user.name).toMatch(/^ada-\d+$/);
  });

  it('does not make a second account for an address another account uses', () => {
    const { accounts } = setup();
    ok(accounts.signIn({ provider: 'google', subject: 'g-1', email: 'ada@example.com' }));
    expect(accounts.signIn({ provider: 'email', subject: 'ada@example.com', email: 'ada@example.com' })).toEqual({
      ok: false,
      error: 'email-in-use',
      methods: ['google'],
    });
    expect(accounts.signIn({ provider: 'github', subject: '9', email: 'ADA@example.com' })).toMatchObject({ ok: false, error: 'email-in-use' });
    expect(Number(accounts.db.prepare('SELECT count(*) AS n FROM users').get()!.n)).toBe(1);
  });

  it('connects more methods to a signed-in account; both then sign in to it', () => {
    const { accounts } = setup();
    const user = ok(accounts.signIn({ provider: 'email', subject: 'ada@example.com', email: 'ada@example.com' })).user;
    expect(ok(accounts.signIn({ provider: 'google', subject: 'g-1', email: 'ada@example.com' }, user.id))).toMatchObject({ linked: true });
    expect(ok(accounts.signIn({ provider: 'google', subject: 'g-1', email: 'ada@example.com' })).user.id).toBe(user.id);
    expect(ok(accounts.signIn({ provider: 'email', subject: 'ada@example.com', email: 'ada@example.com' })).user.id).toBe(user.id);
    expect(accounts.identities(user.id).map((i) => i.provider)).toEqual(['email', 'google']);
  });

  it("refuses to connect another account's method", () => {
    const { accounts } = setup();
    ok(accounts.signIn({ provider: 'github', subject: '1' }));
    const other = ok(accounts.signIn({ provider: 'github', subject: '2' })).user;
    expect(accounts.signIn({ provider: 'github', subject: '1' }, other.id)).toEqual({ ok: false, error: 'linked-elsewhere' });
    expect(ok(accounts.signIn({ provider: 'github', subject: '2' }, other.id))).toMatchObject({ linked: false });
  });

  it('disconnects methods but never the last one', () => {
    const { accounts } = setup();
    const user = ok(accounts.signIn({ provider: 'github', subject: '1' })).user;
    ok(accounts.signIn({ provider: 'google', subject: 'g' }, user.id));
    expect(accounts.unlink(user.id, 'github', '2')).toBe('missing');
    expect(accounts.unlink(user.id, 'github', '1')).toBe('ok');
    expect(accounts.unlink(user.id, 'google', 'g')).toBe('last');
    expect(accounts.identities(user.id).map((i) => i.provider)).toEqual(['google']);
  });

  it('renames within the rules', () => {
    const { accounts } = setup();
    const a = ok(accounts.signIn({ provider: 'github', subject: '1', login: 'ada' })).user;
    const b = ok(accounts.signIn({ provider: 'github', subject: '2', login: 'bob' })).user;
    expect(accounts.rename(a.id, 'x')).toBe('invalid');
    expect(accounts.rename(a.id, 'ada lovelace')).toBe('invalid');
    expect(accounts.rename(a.id, 'BOB')).toBe('taken');
    expect(accounts.rename(b.id, 'BOB')).toBe('ok');
    expect(accounts.rename(a.id, 'Ada_1815')).toBe('ok');
    expect(accounts.user(a.id)!.name).toBe('Ada_1815');
  });
});

describe('sessions', () => {
  it('find the account until signed out', () => {
    const { accounts } = setup();
    const user = ok(accounts.signIn({ provider: 'github', subject: '1' })).user;
    const token = accounts.createSession(user.id);
    expect(accounts.sessionUser(token)).toEqual(user);
    expect(accounts.sessionUser('forged')).toBeUndefined();
    expect(accounts.sessionUser(undefined)).toBeUndefined();
    accounts.endSession(token);
    expect(accounts.sessionUser(token)).toBeUndefined();
  });

  it('store only a hash of the token', () => {
    const { accounts } = setup();
    const user = ok(accounts.signIn({ provider: 'github', subject: '1' })).user;
    const token = accounts.createSession(user.id);
    const stored = String(accounts.db.prepare('SELECT token_hash FROM sessions').get()!.token_hash);
    expect(stored).not.toContain(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it('end after 30 idle days, or 180 days in any case', () => {
    const { accounts, clock } = setup();
    const user = ok(accounts.signIn({ provider: 'github', subject: '1' })).user;
    const idle = accounts.createSession(user.id);
    clock.advance(SESSION_IDLE_MS + 1);
    expect(accounts.sessionUser(idle)).toBeUndefined();

    const busy = accounts.createSession(user.id);
    for (let t = 0; t < SESSION_MAX_MS - 2 * 86_400_000; t += 20 * 86_400_000) {
      clock.advance(20 * 86_400_000);
      expect(accounts.sessionUser(busy)).toEqual(user);
    }
    clock.advance(3 * 86_400_000);
    expect(accounts.sessionUser(busy)).toBeUndefined();
  });

  it('can be ended everywhere but here', () => {
    const { accounts } = setup();
    const user = ok(accounts.signIn({ provider: 'github', subject: '1' })).user;
    const here = accounts.createSession(user.id);
    const there = accounts.createSession(user.id);
    expect(accounts.endOtherSessions(user.id, here)).toBe(1);
    expect(accounts.sessionUser(here)).toEqual(user);
    expect(accounts.sessionUser(there)).toBeUndefined();
  });
});

describe('email links', () => {
  it('work once', () => {
    const { accounts } = setup();
    const token = accounts.createEmailLink('ada@example.com', { returnTo: '/tasks' });
    expect(accounts.peekEmailLink(token)).toEqual({ email: 'ada@example.com', linkTo: null, returnTo: '/tasks' });
    expect(accounts.peekEmailLink(token)).toBeDefined();
    expect(accounts.useEmailLink(token)).toEqual({ email: 'ada@example.com', linkTo: null, returnTo: '/tasks' });
    expect(accounts.useEmailLink(token)).toBeUndefined();
    expect(accounts.peekEmailLink(token)).toBeUndefined();
  });

  it('expire after 15 minutes', () => {
    const { accounts, clock } = setup();
    const token = accounts.createEmailLink('ada@example.com', { returnTo: '/' });
    clock.advance(EMAIL_LINK_MS);
    expect(accounts.useEmailLink(token)).toBeUndefined();
  });

  it('are counted per address', () => {
    const { accounts, clock } = setup();
    accounts.createEmailLink('ada@example.com', { returnTo: '/' });
    clock.advance(60_000);
    accounts.createEmailLink('ada@example.com', { returnTo: '/' });
    accounts.createEmailLink('bob@example.com', { returnTo: '/' });
    expect(accounts.emailLinksWithin('ada@example.com', 3_600_000)).toBe(2);
    expect(accounts.emailLinksWithin('ada@example.com', 60_000)).toBe(1);
  });
});

describe('OAuth flows', () => {
  it('come back once, for the provider they went to', () => {
    const { accounts } = setup();
    const flow = accounts.startOAuth('google', { returnTo: '/account' });
    expect(accounts.finishOAuth('github', flow.state)).toBeUndefined();
    expect(accounts.finishOAuth('google', flow.state)).toEqual({ verifier: flow.verifier, nonce: flow.nonce, linkTo: null, returnTo: '/account' });
    expect(accounts.finishOAuth('google', flow.state)).toBeUndefined();
  });

  it('expire after 10 minutes', () => {
    const { accounts, clock } = setup();
    const flow = accounts.startOAuth('github', { returnTo: '/' });
    clock.advance(10 * 60_000);
    expect(accounts.finishOAuth('github', flow.state)).toBeUndefined();
  });
});

describe('progress', () => {
  it('sums solves per task and lists the newest first', () => {
    const { accounts, clock } = setup();
    const user = ok(accounts.signIn({ provider: 'github', subject: '1' })).user;
    const solve = { taskVersion: 1, judgeVersion: 1 };
    accounts.recordSolve(user.id, { ...solve, taskId: 'delete-a-word', text: 1, keys: 4 });
    clock.advance(1000);
    accounts.recordSolve(user.id, { ...solve, taskId: 'delete-a-word', text: 2, keys: 2 });
    clock.advance(1000);
    accounts.recordSolve(user.id, { ...solve, taskId: 'undo-a-change', text: 1, keys: 2 });
    const progress = accounts.progress(user.id);
    expect(progress.get('delete-a-word')).toMatchObject({ solves: 2, best: 2, texts: 2 });
    expect(progress.get('undo-a-change')).toMatchObject({ solves: 1, best: 2, texts: 1 });
    expect(accounts.history(user.id).map((s) => s.taskId)).toEqual(['undo-a-change', 'delete-a-word', 'delete-a-word']);
    expect(accounts.history(user.id, 1)).toHaveLength(1);
  });
});

describe('deleting an account', () => {
  it('removes its methods, sessions, links and progress', () => {
    const { accounts } = setup();
    const user = ok(accounts.signIn({ provider: 'email', subject: 'ada@example.com', email: 'ada@example.com' })).user;
    const token = accounts.createSession(user.id);
    accounts.createEmailLink('ada@example.com', { linkTo: user.id, returnTo: '/' });
    accounts.startOAuth('github', { linkTo: user.id, returnTo: '/' });
    accounts.recordSolve(user.id, { taskId: 'x', text: 1, taskVersion: 1, judgeVersion: 1, keys: 1 });
    accounts.deleteUser(user.id);
    expect(accounts.sessionUser(token)).toBeUndefined();
    for (const table of ['users', 'identities', 'sessions', 'oauth_flows', 'solves'])
      expect(Number(accounts.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n), table).toBe(0);
    expect(Number(accounts.db.prepare('SELECT count(*) AS n FROM email_links WHERE link_to IS NOT NULL').get()!.n)).toBe(0);
    // The same address can start a new account afterwards.
    expect(ok(accounts.signIn({ provider: 'email', subject: 'ada@example.com', email: 'ada@example.com' })).created).toBe(true);
  });
});
