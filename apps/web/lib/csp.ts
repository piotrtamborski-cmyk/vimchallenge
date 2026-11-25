/**
 * Content Security Policy of the pages. Scripts and style elements run only with the nonce of the
 * response (Next.js puts it on its own scripts; the editor on its style elements) or when loaded
 * by such a script ('strict-dynamic'); everything else comes from this origin.
 */

/** 128 random bits, base64: a fresh one for every page response. */
export function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

export function contentSecurityPolicy(nonce: string, dev = false): string {
  return [
    "default-src 'self'",
    // React uses eval in development only, for error stacks.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Next.js's development overlay injects styles without the nonce; production needs none.
    `style-src 'self' ${dev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
