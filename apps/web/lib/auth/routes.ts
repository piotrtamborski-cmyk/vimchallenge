/**
 * The account endpoints behind app/api/auth and app/api/account. Each takes the request and the
 * accounts context (tests pass an in-memory one) and answers with a redirect to a page that says
 * what happened, so the forms work without JavaScript.
 *
 * Every POST must come from a page of this site (its Origin is checked). OAuth sign-ins start
 * with a GET link and are bound to the browser by a state cookie.
 */
import { authorizeUrl, exchange, normalEmail, OAuthError, signInMail, SESSION_MAX_MS, type OAuthProvider, type Provider } from '@vimchallenge/accounts';
import { readBody } from '../body.ts';
import { forbidden, sameOrigin } from '../origin.ts';
import { clientKey, RateLimiter } from '../rate-limit.ts';
import { clearCookie, flowCookie, readCookie, sessionCookie, setCookie } from './cookies.ts';
import { requestUser, type AuthContext } from './context.ts';

const HOUR = 3_600_000;
const MAX_FORM_BYTES = 16_384;
/** Links one address may receive in an hour. */
export const EMAIL_LINKS_PER_HOUR = 5;

/** Sign-in attempts per client address: 10 at once, then 10 a minute. */
const attempts = new RateLimiter({ burst: 10, perMinute: 10, maxClients: 50_000 });
/** Emails per client address: 10 at once, then 20 an hour (a household or class shares one). */
const mails = new RateLimiter({ burst: 10, perMinute: 20 / 60, maxClients: 50_000 });

const client = (request: Request) => clientKey(request.headers, process.env.CLIENT_IP_HEADER || undefined);

/** A path on this site to return to; anything else (another site, `//host`) becomes `fallback`. */
export function safeReturn(path: string | null | undefined, fallback = '/'): string {
  if (!path || path.length > 512 || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(path) || path.startsWith('/sign-in') || path.startsWith('/api/')) return fallback;
  return path;
}

function redirect(ctx: AuthContext, path: string, cookies: string[] = []): Response {
  const headers = new Headers({ location: new URL(path, ctx.config.publicUrl).toString(), 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 303, headers });
}

/** `/sign-in` with a message code, keeping where to go afterwards. */
function signInPage(ctx: AuthContext, params: Record<string, string>, returnTo?: string): Response {
  const query = new URLSearchParams(params);
  if (returnTo && returnTo !== '/') query.set('next', returnTo);
  return redirect(ctx, `/sign-in?${query}`);
}

const accountPage = (ctx: AuthContext, params: Record<string, string>) => redirect(ctx, `/account?${new URLSearchParams(params)}`);

const fromThisSite = (request: Request, ctx: AuthContext) => sameOrigin(request, ctx.config.publicUrl);
const tooMany = (seconds: number) =>
  new Response('Too many attempts; try again in a minute.', { status: 429, headers: { 'content-type': 'text/plain', 'retry-after': String(seconds) } });

/** The fields of an HTML form (`application/x-www-form-urlencoded`, at most 16 kB). */
async function formOf(request: Request): Promise<URLSearchParams | undefined> {
  if (!/^application\/x-www-form-urlencoded\b/i.test(request.headers.get('content-type') ?? '')) return undefined;
  const body = await readBody(request, MAX_FORM_BYTES);
  return body === undefined ? undefined : new URLSearchParams(body);
}
const field = (form: URLSearchParams, name: string) => form.get(name) ?? '';

/** Signs in: a new session, its cookie, and the old session of this browser ended. */
function startSession(request: Request, ctx: AuthContext, userId: string, returnTo: string): Response {
  const { token: old } = requestUser(request.headers, ctx);
  ctx.accounts.endSession(old);
  const token = ctx.accounts.createSession(userId);
  return redirect(ctx, returnTo, [setCookie(sessionCookie(ctx.config.secure), token, SESSION_MAX_MS / 1000, ctx.config.secure)]);
}

const emailInUse = (ctx: AuthContext, methods: Provider[], returnTo: string) =>
  signInPage(ctx, { error: 'email-in-use', methods: methods.join(',') }, returnTo);

// OAuth

const isOAuth = (p: string): p is OAuthProvider => p === 'github' || p === 'google';
const redirectUri = (ctx: AuthContext, provider: OAuthProvider) => new URL(`/api/auth/${provider}/callback`, ctx.config.publicUrl).toString();

/** GET /api/auth/{provider}/start?next=…[&link=1]: off to the provider. */
export function startOAuth(request: Request, ctx: AuthContext, provider: string): Response {
  const params = new URL(request.url).searchParams;
  const link = params.get('link') === '1';
  if (!isOAuth(provider) || !ctx.config[provider]) return signInPage(ctx, { error: 'provider-off' });
  const rate = attempts.take(client(request));
  if (!rate.allowed) return tooMany(rate.retryAfterSeconds);

  const user = link ? requestUser(request.headers, ctx).user : undefined;
  if (link && !user) return signInPage(ctx, {}, '/account');
  const returnTo = safeReturn(params.get('next'), link ? '/account' : '/');
  const flow = ctx.accounts.startOAuth(provider, { linkTo: user?.id, returnTo });
  const headers = new Headers({
    location: authorizeUrl(provider, ctx.config[provider]!, { redirectUri: redirectUri(ctx, provider), ...flow }),
    'cache-control': 'no-store',
  });
  headers.append('set-cookie', setCookie(flowCookie(ctx.config.secure), flow.state, 600, ctx.config.secure));
  return new Response(null, { status: 302, headers });
}

/** GET /api/auth/{provider}/callback?code=…&state=…: back from the provider. */
export async function oauthCallback(request: Request, ctx: AuthContext, provider: string): Promise<Response> {
  if (!isOAuth(provider) || !ctx.config[provider]) return signInPage(ctx, { error: 'provider-off' });
  const params = new URL(request.url).searchParams;
  const state = params.get('state');
  const cookie = readCookie(request.headers, flowCookie(ctx.config.secure));
  const flow = state && state === cookie ? ctx.accounts.finishOAuth(provider, state) : undefined;
  const done = (response: Response) => {
    response.headers.append('set-cookie', clearCookie(flowCookie(ctx.config.secure), ctx.config.secure));
    return response;
  };
  // No flow: started in another browser, too long ago, or already used.
  if (!flow) return done(signInPage(ctx, { error: 'oauth-expired' }));
  const back = (error: string) => done(flow.linkTo ? accountPage(ctx, { error }) : signInPage(ctx, { error }, flow.returnTo));

  const code = params.get('code');
  if (params.get('error') || !code) return back(params.get('error') === 'access_denied' ? 'oauth-cancelled' : 'oauth-failed');
  let identity;
  try {
    identity = await exchange(provider, ctx.config[provider]!, { code, redirectUri: redirectUri(ctx, provider), verifier: flow.verifier, nonce: flow.nonce }, ctx.oauth);
  } catch (err) {
    if (!(err instanceof OAuthError)) throw err;
    console.error(`${provider} sign-in failed: ${err.message}`);
    return back('oauth-failed');
  }

  if (flow.linkTo) {
    // Connecting needs the same account still signed in in this browser.
    if (requestUser(request.headers, ctx).user?.id !== flow.linkTo) return done(signInPage(ctx, { error: 'oauth-expired' }, '/account'));
    const result = ctx.accounts.signIn(identity, flow.linkTo);
    if (!result.ok) return back(result.error);
    return done(accountPage(ctx, { notice: result.linked ? `connected-${provider}` : 'already-connected' }));
  }
  const result = ctx.accounts.signIn(identity);
  if (!result.ok) return done(result.error === 'email-in-use' ? emailInUse(ctx, result.methods, flow.returnTo) : back(result.error));
  return done(startSession(request, ctx, result.user.id, flow.returnTo));
}

// Email links

/** POST /api/auth/email (email, next, link): sends a sign-in link, or one that adds the address. */
export async function requestEmailLink(request: Request, ctx: AuthContext): Promise<Response> {
  if (!fromThisSite(request, ctx)) return forbidden();
  const form = await formOf(request);
  if (!form) return new Response('Send the form.', { status: 400 });
  const link = field(form, 'link') === '1';
  const returnTo = safeReturn(field(form, 'next'), link ? '/account' : '/');
  const fail = (error: string) => (link ? accountPage(ctx, { error }) : signInPage(ctx, { error }, returnTo));
  if (!ctx.config.mailer) return fail('provider-off');

  const rate = mails.take(client(request));
  if (!rate.allowed) return fail('email-limit');
  const user = link ? requestUser(request.headers, ctx).user : undefined;
  if (link && !user) return signInPage(ctx, {}, '/account');
  const email = normalEmail(field(form, 'email'));
  if (!email) return fail('email-invalid');
  if (ctx.accounts.emailLinksWithin(email, HOUR) >= EMAIL_LINKS_PER_HOUR) return fail('email-limit');

  const token = ctx.accounts.createEmailLink(email, { linkTo: user?.id, returnTo });
  const url = new URL(`/sign-in/email?token=${token}`, ctx.config.publicUrl).toString();
  try {
    await ctx.config.mailer(signInMail(email, url, link));
  } catch (err) {
    console.error(`sign-in email not sent: ${(err as Error).message}`);
    return fail('email-failed');
  }
  return link ? accountPage(ctx, { notice: 'email-sent' }) : signInPage(ctx, { sent: '1' }, returnTo);
}

/** POST /api/auth/email/verify (token): the player confirmed the link from the email. */
export async function verifyEmailLink(request: Request, ctx: AuthContext): Promise<Response> {
  if (!fromThisSite(request, ctx)) return forbidden();
  const rate = attempts.take(client(request));
  if (!rate.allowed) return tooMany(rate.retryAfterSeconds);
  const form = await formOf(request);
  const token = form ? field(form, 'token') : '';
  const pending = token ? ctx.accounts.peekEmailLink(token) : undefined;
  if (!pending) return signInPage(ctx, { error: 'link-expired' });
  if (pending.linkTo && requestUser(request.headers, ctx).user?.id !== pending.linkTo)
    return signInPage(ctx, { error: 'link-other-account' }, '/account');

  const used = ctx.accounts.useEmailLink(token);
  if (!used) return signInPage(ctx, { error: 'link-expired' });
  const identity = { provider: 'email' as const, subject: used.email, email: used.email };
  if (used.linkTo) {
    const result = ctx.accounts.signIn(identity, used.linkTo);
    if (!result.ok) return accountPage(ctx, { error: result.error });
    return accountPage(ctx, { notice: result.linked ? 'connected-email' : 'already-connected' });
  }
  const result = ctx.accounts.signIn(identity);
  if (!result.ok) return result.error === 'email-in-use' ? emailInUse(ctx, result.methods, used.returnTo) : signInPage(ctx, { error: result.error });
  return startSession(request, ctx, result.user.id, used.returnTo);
}

// Session and account

/** POST /api/auth/sign-out */
export function signOut(request: Request, ctx: AuthContext): Response {
  if (!fromThisSite(request, ctx)) return forbidden();
  ctx.accounts.endSession(requestUser(request.headers, ctx).token);
  return redirect(ctx, '/', [clearCookie(sessionCookie(ctx.config.secure), ctx.config.secure)]);
}

/** POST /api/account/{action}: name, disconnect, sessions, delete. */
export async function accountAction(request: Request, ctx: AuthContext, action: string): Promise<Response> {
  if (!fromThisSite(request, ctx)) return forbidden();
  const { user, token } = requestUser(request.headers, ctx);
  if (!user) return signInPage(ctx, {}, '/account');
  const form = (await formOf(request)) ?? new URLSearchParams();

  if (action === 'name') {
    const result = ctx.accounts.rename(user.id, field(form, 'name').trim());
    return accountPage(ctx, result === 'ok' ? { notice: 'renamed' } : { error: `name-${result}` });
  }
  if (action === 'disconnect') {
    const provider = field(form, 'provider') as Provider;
    const result = ctx.accounts.unlink(user.id, provider, field(form, 'subject'));
    return accountPage(ctx, result === 'ok' ? { notice: 'disconnected' } : { error: result === 'last' ? 'last-method' : 'not-connected' });
  }
  if (action === 'sessions') {
    ctx.accounts.endOtherSessions(user.id, token);
    return accountPage(ctx, { notice: 'signed-out-others' });
  }
  if (action === 'delete') {
    if (field(form, 'confirm') !== 'delete') return accountPage(ctx, { error: 'confirm-delete' });
    ctx.accounts.deleteUser(user.id);
    return redirect(ctx, '/sign-in?deleted=1', [clearCookie(sessionCookie(ctx.config.secure), ctx.config.secure)]);
  }
  return new Response('Not found', { status: 404 });
}
