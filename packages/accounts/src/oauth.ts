/**
 * Sign-in with GitHub (OAuth 2.0) and Google (OpenID Connect): the authorization code flow with
 * PKCE (S256) and a one-time state, run on the server. Google's ID token is checked for its
 * signature, issuer, audience, expiry and nonce.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { VerifiedIdentity } from './accounts.ts';
import { codeChallenge } from './tokens.ts';

export type OAuthProvider = 'github' | 'google';

export interface ClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface AuthorizeParams {
  redirectUri: string;
  state: string;
  verifier: string;
  nonce: string;
}

export interface ExchangeParams {
  code: string;
  redirectUri: string;
  verifier: string;
  nonce: string;
}

export interface OAuthDeps {
  fetch?: typeof fetch;
  /** Google's signing keys; tests pass their own. */
  googleKeys?: JWTVerifyGetKey;
}

export class OAuthError extends Error {}

const TIMEOUT_MS = 10_000;
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
let googleKeys: JWTVerifyGetKey | undefined;

/** Where to send the player to sign in at the provider. */
export function authorizeUrl(provider: OAuthProvider, client: ClientConfig, p: AuthorizeParams): string {
  const common = {
    client_id: client.clientId,
    redirect_uri: p.redirectUri,
    state: p.state,
    code_challenge: codeChallenge(p.verifier),
    code_challenge_method: 'S256',
  };
  if (provider === 'github') {
    // user:email lets the app read which addresses GitHub verified (to spot a second account).
    return `https://github.com/login/oauth/authorize?${new URLSearchParams({ ...common, scope: 'user:email', allow_signup: 'true' })}`;
  }
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    ...common,
    response_type: 'code',
    scope: 'openid email',
    nonce: p.nonce,
    prompt: 'select_account',
  })}`;
}

/** Trades the code the provider sent back for the identity of the player who signed in. */
export async function exchange(provider: OAuthProvider, client: ClientConfig, p: ExchangeParams, deps: OAuthDeps = {}): Promise<VerifiedIdentity> {
  const f = deps.fetch ?? fetch;
  return provider === 'github' ? github(f, client, p) : google(f, client, p, deps.googleKeys);
}

async function github(f: typeof fetch, client: ClientConfig, p: ExchangeParams): Promise<VerifiedIdentity> {
  const token = await json<{ access_token?: string; error?: string }>(
    f('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code: p.code,
        redirect_uri: p.redirectUri,
        code_verifier: p.verifier,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  );
  if (!token.access_token) throw new OAuthError(`GitHub refused the code: ${token.error ?? 'no access token'}`);
  const api = (path: string) =>
    f(`https://api.github.com${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token.access_token}`,
        'user-agent': 'vimchallenge',
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  const user = await json<{ id?: number; login?: string }>(api('/user'));
  if (typeof user.id !== 'number') throw new OAuthError('GitHub sent no user id');
  const emails = await json<{ email: string; primary: boolean; verified: boolean }[]>(api('/user/emails')).catch(() => []);
  const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) : undefined;
  return { provider: 'github', subject: String(user.id), email: primary?.email.toLowerCase() ?? null, login: user.login };
}

async function google(f: typeof fetch, client: ClientConfig, p: ExchangeParams, keys?: JWTVerifyGetKey): Promise<VerifiedIdentity> {
  const token = await json<{ id_token?: string; error?: string }>(
    f('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code: p.code,
        redirect_uri: p.redirectUri,
        code_verifier: p.verifier,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  );
  if (!token.id_token) throw new OAuthError(`Google refused the code: ${token.error ?? 'no ID token'}`);
  keys ??= googleKeys ??= createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(token.id_token, keys, { issuer: GOOGLE_ISSUERS, audience: client.clientId }));
  } catch (err) {
    throw new OAuthError(`Google's ID token is not valid: ${(err as Error).message}`);
  }
  if (claims.nonce !== p.nonce) throw new OAuthError("Google's ID token has another nonce");
  if (typeof claims.sub !== 'string' || !claims.sub) throw new OAuthError("Google's ID token has no subject");
  const email = claims.email_verified === true && typeof claims.email === 'string' ? claims.email.toLowerCase() : null;
  return { provider: 'google', subject: claims.sub, email };
}

async function json<T>(response: Promise<Response>): Promise<T> {
  let res: Response;
  try {
    res = await response;
  } catch (err) {
    throw new OAuthError(`the provider could not be reached: ${(err as Error).message}`);
  }
  const body = await res.json().catch(() => undefined);
  if (!res.ok && !(body && typeof body === 'object' && 'error' in body)) throw new OAuthError(`the provider answered HTTP ${res.status}`);
  return body as T;
}
