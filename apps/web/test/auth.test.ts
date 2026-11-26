/** Sign-in and account endpoints, end to end against an in-memory database and fake providers. */
import { Accounts, openDatabase, type Mail } from '@vimchallenge/accounts';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../lib/auth/context.ts';
import { accountAction, oauthCallback, requestEmailLink, safeReturn, signOut, startOAuth, verifyEmailLink } from '../lib/auth/routes.ts';

const SITE = 'https://vimchallenge.test';
const { publicKey, privateKey } = await generateKeyPair('RS256');
const googleKeys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k', alg: 'RS256' }] });

let clients = 0;

/** A fresh site: its own database, mailbox, provider accounts and client address. */
function site() {
  const mails: Mail[] = [];
  const github = { id: 1, login: 'octocat', email: 'octo@example.com' };
  const google = { sub: 'g-1', email: 'ada@example.com' };
  let nonce = '';
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'gho' });
    if (url === 'https://api.github.com/user') return Response.json({ id: github.id, login: github.login });
    if (url === 'https://api.github.com/user/emails') return Response.json([{ email: github.email, primary: true, verified: true }]);
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(String(init?.body));
      if (body.get('code') !== 'good') return Response.json({ error: 'invalid_grant' }, { status: 400 });
      const idToken = await new SignJWT({ nonce, email: google.email, email_verified: true })
        .setProtectedHeader({ alg: 'RS256', kid: 'k' })
        .setIssuer('https://accounts.google.com')
        .setAudience('google-client')
        .setSubject(google.sub)
        .setExpirationTime('5m')
        .sign(privateKey);
      return Response.json({ id_token: idToken });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  const ctx: AuthContext = {
    config: {
      publicUrl: new URL(SITE),
      secure: true,
      databasePath: ':memory:',
      github: { clientId: 'github-client', clientSecret: 's' },
      google: { clientId: 'google-client', clientSecret: 's' },
      mailer: async (m) => void mails.push(m),
    },
    accounts: new Accounts(openDatabase(':memory:')),
    oauth: { fetch: fakeFetch, googleKeys },
  };
  const ip = `192.0.2.${++clients}`;
  let cookies: Record<string, string> = {};

  /** Keeps the cookies a response sets, like a browser. */
  const keep = (res: Response) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split('; ');
      const [name, value] = pair!.split('=') as [string, string];
      if (attrs.includes('Max-Age=0')) delete cookies[name];
      else cookies[name] = decodeURIComponent(value);
    }
    return res;
  };
  const headers = (extra: Record<string, string> = {}) => {
    const cookie = Object.entries(cookies)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('; ');
    return { 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}), ...extra };
  };
  const get = (path: string) => new Request(SITE + path, { headers: headers() });
  const post = (path: string, form: Record<string, string>, origin = SITE) =>
    new Request(SITE + path, { method: 'POST', headers: headers({ origin }), body: new URLSearchParams(form) });

  const where = (res: Response) => {
    const url = new URL(res.headers.get('location')!);
    return url.origin === SITE ? url.pathname + url.search : url.toString();
  };
  const user = () => ctx.accounts.sessionUser(cookies['__Host-vc_session']);

  async function emailSignIn(email: string, extra: Record<string, string> = {}) {
    const asked = keep(await requestEmailLink(post('/api/auth/email', { email, ...extra }), ctx));
    const link = new URL(mails.at(-1)!.text.match(/https:\S+/)![0]);
    return { asked, link, done: keep(await verifyEmailLink(post('/api/auth/email/verify', { token: link.searchParams.get('token')! }), ctx)) };
  }

  async function oauth(provider: 'github' | 'google', { link = false, code = 'good', next = '' } = {}) {
    const query = new URLSearchParams({ ...(link ? { link: '1' } : {}), ...(next ? { next } : {}) });
    const start = keep(startOAuth(get(`/api/auth/${provider}/start?${query}`), ctx, provider));
    const authorize = new URL(start.headers.get('location')!);
    nonce = authorize.searchParams.get('nonce') ?? '';
    const state = authorize.searchParams.get('state')!;
    const back = keep(await oauthCallback(get(`/api/auth/${provider}/callback?code=${code}&state=${state}`), ctx, provider));
    return { start, authorize, state, back };
  }

  return { ctx, mails, github, google, cookies: () => cookies, keep, get, post, where, user, emailSignIn, oauth, forget: () => (cookies = {}) };
}

describe('sign-in with an email link', () => {
  it('sends a one-time link that signs in after the player confirms', async () => {
    const s = site();
    const { asked, link, done } = await s.emailSignIn('Ada@Example.com', { next: '/tasks/undo-a-change' });
    expect(s.where(asked)).toBe('/sign-in?sent=1&next=%2Ftasks%2Fundo-a-change');
    expect(s.mails).toHaveLength(1);
    expect(s.mails[0]!.to).toBe('ada@example.com');
    expect(link.origin + link.pathname).toBe(`${SITE}/sign-in/email`);
    expect(done.status).toBe(303);
    expect(s.where(done)).toBe('/tasks/undo-a-change');
    expect(done.headers.getSetCookie()[0]).toMatch(/^__Host-vc_session=[\w-]{43}; Path=\/; Max-Age=15552000; HttpOnly; SameSite=Lax; Secure$/);
    expect(s.user()?.name).toMatch(/^vimmer-/);

    // The link works once.
    const again = await verifyEmailLink(s.post('/api/auth/email/verify', { token: link.searchParams.get('token')! }), s.ctx);
    expect(s.where(again)).toBe('/sign-in?error=link-expired');
  });

  it('signs in to the same account the next time', async () => {
    const s = site();
    await s.emailSignIn('ada@example.com');
    const first = s.user()!;
    s.forget();
    await s.emailSignIn('ada@example.com');
    expect(s.user()).toEqual(first);
  });

  it('refuses addresses that are not ones, and too many links to one address', async () => {
    const s = site();
    expect(s.where(await requestEmailLink(s.post('/api/auth/email', { email: 'not an address' }), s.ctx))).toBe('/sign-in?error=email-invalid');
    for (let i = 0; i < 5; i++) await requestEmailLink(s.post('/api/auth/email', { email: 'ada@example.com' }), s.ctx);
    expect(s.where(await requestEmailLink(s.post('/api/auth/email', { email: 'ada@example.com' }), s.ctx))).toBe('/sign-in?error=email-limit');
    expect(s.mails).toHaveLength(5);
  });

  it('accepts forms from this site only', async () => {
    const s = site();
    expect((await requestEmailLink(s.post('/api/auth/email', { email: 'ada@example.com' }, 'https://evil.example'), s.ctx)).status).toBe(403);
    const noOrigin = new Request(`${SITE}/api/auth/email`, { method: 'POST', body: new URLSearchParams({ email: 'ada@example.com' }) });
    expect((await requestEmailLink(noOrigin, s.ctx)).status).toBe(403);
    const crossSite = s.post('/api/auth/email', { email: 'ada@example.com' }, 'null');
    crossSite.headers.set('sec-fetch-site', 'cross-site');
    expect((await requestEmailLink(crossSite, s.ctx)).status).toBe(403);
    expect(s.mails).toHaveLength(0);
    // Origin "null" (a no-referrer page) from this site itself.
    const sameSite = s.post('/api/auth/email', { email: 'ada@example.com' }, 'null');
    sameSite.headers.set('sec-fetch-site', 'same-origin');
    expect((await requestEmailLink(sameSite, s.ctx)).status).toBe(303);
  });

  it('never returns to another site', () => {
    expect(safeReturn('/tasks/x?text=2')).toBe('/tasks/x?text=2');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'tasks', '/sign-in?next=/x', '/api/auth/sign-out', '/a\nb', null])
      expect(safeReturn(bad)).toBe('/');
  });
});

describe('sign-in with GitHub and Google', () => {
  it('goes to GitHub with a state bound to this browser, and comes back signed in', async () => {
    const s = site();
    const { start, authorize, state, back } = await s.oauth('github', { next: '/lessons' });
    expect(start.status).toBe(302);
    expect(authorize.origin + authorize.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${SITE}/api/auth/github/callback`);
    expect(start.headers.getSetCookie()[0]).toMatch(new RegExp(`^__Host-vc_oauth=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax; Secure$`));
    expect(s.where(back)).toBe('/lessons');
    expect(s.cookies()['__Host-vc_oauth']).toBeUndefined();
    expect(s.user()?.name).toBe('octocat');
  });

  it('refuses a callback from another browser, or one that comes twice', async () => {
    const s = site();
    const start = startOAuth(s.get('/api/auth/github/start'), s.ctx, 'github');
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    // This browser never got the state cookie.
    const foreign = await oauthCallback(s.get(`/api/auth/github/callback?code=good&state=${state}`), s.ctx, 'github');
    expect(s.where(foreign)).toBe('/sign-in?error=oauth-expired');
    expect(s.user()).toBeUndefined();

    const { state: used } = await s.oauth('github');
    s.forget();
    s.keep(new Response(null, { headers: { 'set-cookie': `__Host-vc_oauth=${used}` } }));
    const twice = await oauthCallback(s.get(`/api/auth/github/callback?code=good&state=${used}`), s.ctx, 'github');
    expect(s.where(twice)).toBe('/sign-in?error=oauth-expired');
  });

  it('says so when the player cancels or the provider refuses', async () => {
    const s = site();
    const start = s.keep(startOAuth(s.get('/api/auth/google/start'), s.ctx, 'google'));
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const cancelled = await oauthCallback(s.get(`/api/auth/google/callback?error=access_denied&state=${state}`), s.ctx, 'google');
    expect(s.where(cancelled)).toBe('/sign-in?error=oauth-cancelled');
    expect(s.where((await s.oauth('google', { code: 'bad' })).back)).toBe('/sign-in?error=oauth-failed');
  });

  it('is off for a provider without a client', async () => {
    const s = site();
    delete s.ctx.config.google;
    expect(s.where(startOAuth(s.get('/api/auth/google/start'), s.ctx, 'google'))).toBe('/sign-in?error=provider-off');
    expect(s.where(startOAuth(s.get('/api/auth/gitlab/start'), s.ctx, 'gitlab'))).toBe('/sign-in?error=provider-off');
  });
});

describe('one account, several ways in', () => {
  it('connects Google and an email address to a GitHub account; each then signs in to it', async () => {
    const s = site();
    await s.oauth('github');
    const owner = s.user()!;

    const linked = await s.oauth('google', { link: true });
    expect(s.where(linked.back)).toBe('/account?notice=connected-google');
    const added = await s.emailSignIn('second@example.com', { link: '1' });
    expect(s.where(added.asked)).toBe('/account?notice=email-sent');
    expect(s.where(added.done)).toBe('/account?notice=connected-email');

    for (const way of [() => s.oauth('google'), () => s.emailSignIn('second@example.com'), () => s.oauth('github')]) {
      s.forget();
      await way();
      expect(s.user()?.id).toBe(owner.id);
    }
    expect(s.ctx.accounts.identities(owner.id).map((i) => i.provider)).toEqual(['github', 'google', 'email']);
  });

  it('does not open a second account for an address in use, and says how to get in', async () => {
    const s = site();
    s.google.email = 'octo@example.com';
    await s.oauth('github');
    s.forget();
    const { back } = await s.oauth('google', { next: '/tasks' });
    expect(s.where(back)).toBe('/sign-in?error=email-in-use&methods=github&next=%2Ftasks');
    const { done } = await s.emailSignIn('octo@example.com');
    expect(s.where(done)).toBe('/sign-in?error=email-in-use&methods=github');
    expect(s.user()).toBeUndefined();
  });

  it("will not connect a method another account has", async () => {
    const s = site();
    await s.oauth('google');
    s.forget();
    s.google.email = 'other@example.com';
    await s.oauth('github');
    expect(s.where((await s.oauth('google', { link: true })).back)).toBe('/account?error=linked-elsewhere');
  });

  it('adds an address only in the browser of the account that asked', async () => {
    const s = site();
    await s.oauth('github');
    await requestEmailLink(s.post('/api/auth/email', { email: 'new@example.com', link: '1' }), s.ctx);
    const token = new URL(s.mails.at(-1)!.text.match(/https:\S+/)![0]).searchParams.get('token')!;
    s.forget();
    const elsewhere = await verifyEmailLink(s.post('/api/auth/email/verify', { token }), s.ctx);
    expect(s.where(elsewhere)).toBe('/sign-in?error=link-other-account&next=%2Faccount');
  });
});

describe('the account page', () => {
  it('renames, keeps the last method, signs out other devices and signs out', async () => {
    const s = site();
    await s.oauth('github');
    const me = s.user()!;
    const act = async (action: string, form: Record<string, string> = {}) => s.where(s.keep(await accountAction(s.post(`/api/account/${action}`, form), s.ctx, action)));

    expect(await act('name', { name: 'Vim_Ada' })).toBe('/account?notice=renamed');
    expect(s.user()?.name).toBe('Vim_Ada');
    expect(await act('name', { name: 'no spaces' })).toBe('/account?error=name-invalid');
    expect(await act('disconnect', { provider: 'github', subject: '1' })).toBe('/account?error=last-method');

    const other = s.ctx.accounts.createSession(me.id);
    expect(await act('sessions')).toBe('/account?notice=signed-out-others');
    expect(s.ctx.accounts.sessionUser(other)).toBeUndefined();
    expect(s.user()?.id).toBe(me.id);

    const out = s.keep(signOut(s.post('/api/auth/sign-out', {}), s.ctx));
    expect(s.where(out)).toBe('/');
    expect(s.user()).toBeUndefined();
    expect(s.ctx.accounts.sessionCount(me.id)).toBe(0);
  });

  it('deletes the account only when confirmed', async () => {
    const s = site();
    await s.oauth('github');
    const me = s.user()!;
    const del = (form: Record<string, string>) => accountAction(s.post('/api/account/delete', form), s.ctx, 'delete');
    expect(s.where(await del({}))).toBe('/account?error=confirm-delete');
    const res = s.keep(await del({ confirm: 'delete' }));
    expect(s.where(res)).toBe('/sign-in?deleted=1');
    expect(s.ctx.accounts.user(me.id)).toBeUndefined();
    expect(s.cookies()['__Host-vc_session']).toBeUndefined();
  });

  it('needs a signed-in player and a form from this site', async () => {
    const s = site();
    expect(s.where(await accountAction(s.post('/api/account/name', { name: 'abc' }), s.ctx, 'name'))).toBe('/sign-in?next=%2Faccount');
    await s.oauth('github');
    expect((await accountAction(s.post('/api/account/delete', { confirm: 'delete' }, 'https://evil.example'), s.ctx, 'delete')).status).toBe(403);
    expect(s.user()).toBeDefined();
  });
});
