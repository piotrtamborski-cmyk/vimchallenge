/**
 * The languages of the site and how a request gets one. English has no prefix in the address
 * (`/lessons`), every other language has its code (`/de/lessons`). Pure functions: the proxy, the
 * pages and the tests share them.
 */

export const DEFAULT_LANG = 'en';

/** Languages players can choose. A language joins this list once its messages are translated. */
export const LANGS: readonly string[] = ['en'];

/**
 * A made-up language for development: every message stretched and accented, so text left out of
 * the dictionaries and layouts too tight for longer languages show at a glance. `/xx/…` locally.
 */
export const PSEUDO_LANG = 'xx';

/** Each language by its own name, for the language menu. */
export const LANG_NAMES: Readonly<Record<string, string>> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  fr: 'Français',
  it: 'Italiano',
  pl: 'Polski',
  pt: 'Português',
  xx: 'Pseudo',
};

/** The cookie with the language last used on this browser: chosen, or found from the browser. */
export const LANG_COOKIE = 'vc_lang';
/** Set for one page view after the language was taken from the browser, to say so on the page. */
export const LANG_AUTO_COOKIE = 'vc_lang_auto';
/** A year, in seconds. */
export const LANG_COOKIE_MAX_AGE = 365 * 24 * 3600;

const pseudoOn = () => process.env.NODE_ENV !== 'production';

/** Languages a page can be shown in here: the public ones, and the pseudo language in development. */
export function availableLangs(): readonly string[] {
  return pseudoOn() ? [...LANGS, PSEUDO_LANG] : LANGS;
}

export const isLang = (s: string | undefined | null, langs = availableLangs()): s is string => !!s && langs.includes(s);

/** Locale for `Intl` formatting: British English for English, as the site's text is written. */
export const intlLocale = (lang: string) => (lang === DEFAULT_LANG || lang === PSEUDO_LANG ? 'en-GB' : lang);

/** `/de/tasks?x` → `{ lang: 'de', path: '/tasks?x' }`; a path without a language code has no `lang`. */
export function splitLang(path: string, langs = availableLangs()): { lang?: string; path: string } {
  const m = /^\/([a-z]{2})(?=\/|\?|#|$)(.*)$/.exec(path);
  if (!m || !langs.includes(m[1]!)) return { path };
  const rest = m[2]!;
  return { lang: m[1]!, path: rest.startsWith('/') ? rest : `/${rest}` };
}

/** The address of a page of the site in a language: `('de', '/tasks')` → `/de/tasks`, English without a prefix. */
export function localePath(lang: string, path: string): string {
  if (lang === DEFAULT_LANG) return path;
  return path === '/' ? `/${lang}` : `/${lang}${path}`;
}

/**
 * The best language for an `Accept-Language` header, or undefined when none of the browser's
 * languages is available. Weights are honoured; regions fall back to the language (`de-AT` → `de`).
 */
export function negotiate(header: string | null | undefined, langs = availableLangs()): string | undefined {
  if (!header) return undefined;
  const wanted = header
    .split(',')
    .map((part, i) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return { lang: tag.trim().toLowerCase().split('-')[0]!, q: q === undefined ? 1 : Number(q), i };
    })
    .filter((w) => w.lang && w.q > 0 && Number.isFinite(w.q))
    .sort((a, b) => b.q - a.q || a.i - b.i);
  // The pseudo language is for development by address only, never chosen for a browser.
  return wanted.find((w) => w.lang !== PSEUDO_LANG && langs.includes(w.lang))?.lang;
}

export type LangRoute =
  /** Show the page (English addresses reach `app/[lang]` through `englishRewrites`). */
  | { kind: 'page'; lang: string; setCookie?: string }
  /** Send the browser elsewhere. `auto`: the language came from the browser, not from a choice. */
  | { kind: 'redirect'; to: string; setCookie?: string; auto?: boolean };

/**
 * Which language a page request gets, in this order:
 * 1. A language code in the address always wins and is remembered (`/en/…` redirects to the
 *    address without a prefix, which is how a player switches back to English).
 * 2. Otherwise the remembered language: an address without a prefix goes to that language.
 * 3. Otherwise the browser's languages (`Accept-Language`), remembered from then on.
 * 4. Otherwise English, with nothing remembered.
 *
 * `pathname` is without the query; the caller keeps the query on the new address.
 */
export function routeLang(pathname: string, cookie: string | undefined, acceptLanguage: string | null, langs = availableLangs()): LangRoute {
  const { lang, path: rest } = splitLang(pathname, langs);
  const remembered = isLang(cookie, langs) ? cookie : undefined;
  if (lang === DEFAULT_LANG) return { kind: 'redirect', to: rest, setCookie: DEFAULT_LANG };
  if (lang) return { kind: 'page', lang, setCookie: remembered === lang ? undefined : lang };
  if (remembered && remembered !== DEFAULT_LANG) return { kind: 'redirect', to: localePath(remembered, rest) };
  if (!remembered) {
    const found = negotiate(acceptLanguage, langs);
    if (found && found !== DEFAULT_LANG) return { kind: 'redirect', to: localePath(found, rest), setCookie: found, auto: true };
  }
  return { kind: 'page', lang: DEFAULT_LANG };
}

/**
 * The rewrites that serve an English address without a prefix from `app/[lang]` as `en`:
 * `/lessons` → `/en/lessons`. They are Next.js rewrites (next.config.ts), not the proxy's: a
 * proxy rewrite to `localhost` is taken for another site when the server listens on 127.0.0.1.
 * Addresses that start with any language code, the API, Next.js's own and files are left alone.
 */
export function englishRewrites() {
  const codes = Object.keys(LANG_NAMES).join('|');
  return [
    { source: '/', destination: `/${DEFAULT_LANG}` },
    { source: `/:path((?!(?:${codes})(?:/|$)|api(?:/|$)|_next/|__next|.*\\.).+)`, destination: `/${DEFAULT_LANG}/:path` },
  ];
}
