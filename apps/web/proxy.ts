/**
 * Runs before every page:
 * - picks the page's language (see `routeLang`): an address without a language code is English
 *   (served from `app/[lang]` as `en` by the rewrites in next.config.ts), unless the browser's
 *   remembered or preferred language sends it to `/de/…` and the like;
 * - makes a nonce, sends the Content Security Policy with it, and passes both to the rendering
 *   (Next.js reads the policy from the request to put the nonce on its scripts; the layout reads
 *   `x-nonce` for the editor). Pages are therefore rendered per request.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, newNonce } from './lib/csp.ts';
import { DEFAULT_LANG, LANG_AUTO_COOKIE, LANG_COOKIE, LANG_COOKIE_MAX_AGE, routeLang } from './lib/i18n/locales.ts';

const isPrefetch = (request: NextRequest) =>
  request.headers.has('next-router-prefetch') || request.headers.get('purpose') === 'prefetch';

export function proxy(request: NextRequest) {
  const secure = request.nextUrl.protocol === 'https:';
  const remember = (response: NextResponse, lang: string | undefined) => {
    // A prefetch is not a visit: it neither remembers a language nor uses up the notice.
    if (!lang || isPrefetch(request)) return;
    response.cookies.set(LANG_COOKIE, lang, { path: '/', maxAge: LANG_COOKIE_MAX_AGE, sameSite: 'lax', secure });
  };

  const route = routeLang(request.nextUrl.pathname, request.cookies.get(LANG_COOKIE)?.value, request.headers.get('accept-language'));
  if (route.kind === 'redirect') {
    const to = request.nextUrl.clone();
    to.pathname = route.to;
    const response = NextResponse.redirect(to, 307);
    // Where it leads depends on the cookie and the browser's languages: never share it in a cache.
    response.headers.set('cache-control', 'private, no-store');
    response.headers.set('vary', 'Accept-Language, Cookie');
    remember(response, route.setCookie);
    if (route.auto && !isPrefetch(request)) response.cookies.set(LANG_AUTO_COOKIE, '1', { path: '/', sameSite: 'lax', secure });
    return response;
  }

  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development');
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', policy);
  // The page under the language code: what the layout needs for the language menu and `hreflang`.
  const page = route.lang === DEFAULT_LANG ? request.nextUrl.pathname : request.nextUrl.pathname.slice(route.lang.length + 1) || '/';
  headers.set('x-page-path', page + request.nextUrl.search);
  headers.set('x-page-lang', route.lang);
  const auto = request.cookies.has(LANG_AUTO_COOKIE) && !isPrefetch(request);
  if (auto) headers.set('x-lang-auto', '1');
  else headers.delete('x-lang-auto');

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', policy);
  response.headers.set('vary', 'Accept-Language, Cookie');
  remember(response, route.setCookie);
  // The notice that the language came from the browser shows on one page only.
  if (auto) response.cookies.delete(LANG_AUTO_COOKIE);
  return response;
}

export const config = {
  matcher: [
    // Pages only: not the API (JSON), Next.js's own addresses (`/_next/…`, `/__nextjs…`) or files
    // (anything with a dot in it). Link prefetches too, as their addresses need the same language
    // routing as the pages.
    '/((?!api|_next|__next|.*\\.).*)',
  ],
};
