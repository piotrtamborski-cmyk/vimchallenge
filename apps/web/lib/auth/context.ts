/**
 * The accounts store and settings of this process. The database opens on first use, so pages
 * of visitors who are not signed in never touch it.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Accounts, openDatabase, type OAuthDeps, type User } from '@vimchallenge/accounts';
import { configFromEnv, type AuthConfig } from './config.ts';
import { readCookie, sessionCookie } from './cookies.ts';

export interface AuthContext {
  config: AuthConfig;
  accounts: Accounts;
  /** Provider HTTP calls; tests pass fakes. */
  oauth?: OAuthDeps;
}

// Kept on globalThis so that development reloads do not open the database again and again.
const store = globalThis as typeof globalThis & { __vcConfig?: AuthConfig; __vcAuth?: AuthContext };

export function authConfig(): AuthConfig {
  return (store.__vcConfig ??= configFromEnv());
}

export function authContext(): AuthContext {
  if (!store.__vcAuth) {
    const config = authConfig();
    mkdirSync(dirname(config.databasePath), { recursive: true });
    store.__vcAuth = { config, accounts: new Accounts(openDatabase(config.databasePath)) };
  }
  return store.__vcAuth;
}

/** The session token a request carries, if any. */
export const sessionToken = (headers: Headers, config: AuthConfig) => readCookie(headers, sessionCookie(config.secure));

/** The signed-in player of a request; opens the database only when the request has a session cookie. */
export function requestUser(headers: Headers, ctx?: AuthContext): { user?: User; token?: string } {
  const token = sessionToken(headers, ctx?.config ?? authConfig());
  if (!token) return {};
  return { user: (ctx ?? authContext()).accounts.sessionUser(token), token };
}

/** Replaces the context of this process (tests). */
export function setAuthContext(ctx: AuthContext | undefined): void {
  store.__vcAuth = ctx;
  store.__vcConfig = ctx?.config;
}
