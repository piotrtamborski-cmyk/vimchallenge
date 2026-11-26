/** The two cookies of the site: the session, and the state of an OAuth sign-in in progress. */

/** Host-only and HTTPS-only in production (`__Host-`); plain names on http://localhost. */
export const sessionCookie = (secure: boolean) => (secure ? '__Host-vc_session' : 'vc_session');
export const flowCookie = (secure: boolean) => (secure ? '__Host-vc_oauth' : 'vc_oauth');

export function readCookie(headers: Headers, name: string): string | undefined {
  for (const part of (headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * `HttpOnly` keeps scripts away from it; `SameSite=Lax` sends it on top-level navigations only,
 * which the OAuth providers' redirects back to the site are.
 */
export function setCookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return [`${name}=${encodeURIComponent(value)}`, 'Path=/', `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax', ...(secure ? ['Secure'] : [])].join('; ');
}

export const clearCookie = (name: string, secure: boolean) => setCookie(name, '', 0, secure);
