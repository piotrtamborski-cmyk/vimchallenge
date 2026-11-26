import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { authorizeUrl, exchange, OAuthError } from '../src/index.ts';
import { codeChallenge } from '../src/tokens.ts';

const client = { clientId: 'client-1', clientSecret: 'secret-1' };
const params = { code: 'code-1', redirectUri: 'https://vimchallenge.test/api/auth/x/callback', verifier: 'verifier-1', nonce: 'nonce-1' };

type Handler = (url: string, init: RequestInit) => unknown;

/** A fetch that answers from `routes` and records what it was sent. */
function fakeFetch(routes: Record<string, Handler>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const handler = routes[url];
    if (!handler) return new Response('not found', { status: 404 });
    const body = handler(url, init);
    return body instanceof Response ? body : Response.json(body);
  }) as typeof fetch;
  return { f, calls };
}

describe('authorizeUrl', () => {
  it('sends GitHub the state and the PKCE challenge', () => {
    const url = new URL(authorizeUrl('github', client, { redirectUri: params.redirectUri, state: 's', verifier: 'v', nonce: 'n' }));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-1',
      redirect_uri: params.redirectUri,
      state: 's',
      code_challenge: codeChallenge('v'),
      code_challenge_method: 'S256',
      scope: 'user:email',
    });
    expect(url.searchParams.has('client_secret')).toBe(false);
  });

  it('asks Google for openid and email, with a nonce', () => {
    const url = new URL(authorizeUrl('google', client, { redirectUri: params.redirectUri, state: 's', verifier: 'v', nonce: 'n' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', scope: 'openid email', nonce: 'n', code_challenge_method: 'S256' });
  });
});

describe('GitHub', () => {
  const routes = (emails: unknown): Record<string, Handler> => ({
    'https://github.com/login/oauth/access_token': () => ({ access_token: 'gho_1', token_type: 'bearer' }),
    'https://api.github.com/user': () => ({ id: 583231, login: 'octocat' }),
    'https://api.github.com/user/emails': () => emails,
  });

  it('returns the user id, login and verified primary address', async () => {
    const { f, calls } = fakeFetch(
      routes([
        { email: 'old@example.com', primary: false, verified: true },
        { email: 'Octo@Example.com', primary: true, verified: true },
      ]),
    );
    expect(await exchange('github', client, params, { fetch: f })).toEqual({
      provider: 'github',
      subject: '583231',
      email: 'octo@example.com',
      login: 'octocat',
    });
    const body = new URLSearchParams(String(calls[0]!.init.body));
    expect(Object.fromEntries(body)).toMatchObject({ code: 'code-1', code_verifier: 'verifier-1', client_secret: 'secret-1' });
    expect(new Headers(calls[1]!.init.headers).get('authorization')).toBe('Bearer gho_1');
  });

  it('keeps no address GitHub did not verify', async () => {
    const { f } = fakeFetch(routes([{ email: 'octo@example.com', primary: true, verified: false }]));
    expect((await exchange('github', client, params, { fetch: f })).email).toBeNull();
  });

  it('fails when GitHub refuses the code', async () => {
    const { f } = fakeFetch({ 'https://github.com/login/oauth/access_token': () => ({ error: 'bad_verification_code' }) });
    await expect(exchange('github', client, params, { fetch: f })).rejects.toThrow(/bad_verification_code/);
  });
});

describe('Google', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });
  const idToken = (claims: Record<string, unknown>, opts: { aud?: string; iss?: string; exp?: string } = {}) =>
    new SignJWT({ nonce: 'nonce-1', email: 'Ada@Example.com', email_verified: true, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(opts.iss ?? 'https://accounts.google.com')
      .setAudience(opts.aud ?? 'client-1')
      .setSubject('1100')
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '5m')
      .sign(privateKey);
  const run = async (token: string) => {
    const { f } = fakeFetch({ 'https://oauth2.googleapis.com/token': () => ({ id_token: token, access_token: 'ya29' }) });
    return exchange('google', client, params, { fetch: f, googleKeys: keys });
  };

  it('returns the subject and the verified address', async () => {
    expect(await run(await idToken({}))).toEqual({ provider: 'google', subject: '1100', email: 'ada@example.com' });
  });

  it('keeps no address Google did not verify', async () => {
    expect((await run(await idToken({ email_verified: false }))).email).toBeNull();
  });

  it('rejects tokens for another app, from another issuer, expired, or with another nonce', async () => {
    await expect(run(await idToken({}, { aud: 'client-2' }))).rejects.toThrow(OAuthError);
    await expect(run(await idToken({}, { iss: 'https://evil.example' }))).rejects.toThrow(OAuthError);
    await expect(run(await idToken({}, { exp: '-1m' }))).rejects.toThrow(OAuthError);
    await expect(run(await idToken({ nonce: 'other' }))).rejects.toThrow(/nonce/);
  });

  it('rejects a token signed with another key', async () => {
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({ nonce: 'nonce-1' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer('https://accounts.google.com')
      .setAudience('client-1')
      .setSubject('1100')
      .setExpirationTime('5m')
      .sign(other.privateKey);
    await expect(run(forged)).rejects.toThrow(OAuthError);
  });
});
