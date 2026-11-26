import { createHash, randomBytes } from 'node:crypto';

/** 256 random bits, URL-safe: session tokens, link tokens, OAuth state, PKCE verifiers. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

/** What is stored for a token: a leaked database lets no one sign in. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

/** PKCE S256 code challenge of a verifier. */
export const codeChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');
