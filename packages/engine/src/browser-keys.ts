/**
 * Maps a browser keyboard event to an engine token (see keys.ts). Pure, so it can be tested
 * without a browser.
 */

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type KeyDecision =
  /** Feed this token to the engine. */
  | { kind: 'token'; token: string }
  /** Leave the key to the browser (shortcuts, focus moves, modifier keys); the engine never sees it. */
  | { kind: 'pass' }
  /** Swallow the key: it would change the editor in a way the judge cannot replay. */
  | { kind: 'unsupported'; name: string };

const NAMED: Record<string, string> = {
  Escape: '<Esc>', Enter: '<CR>', Backspace: '<BS>', Tab: '<Tab>', Delete: '<Del>',
  ArrowUp: '<Up>', ArrowDown: '<Down>', ArrowLeft: '<Left>', ArrowRight: '<Right>',
};

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'Hyper', 'Super']);

/** Control characters vim-core knows besides letters: <C-[> is Esc, <C-^>, <C-_>, <C-@> … */
const CTRL_PUNCTUATION = new Set(['[', ']', '\\', '^', '_', '@']);

const isSingleChar = (key: string) => key.length > 0 && [...key].length === 1;

/** Token of one typed character. */
export function charToken(ch: string): string {
  if (ch === ' ') return '<Space>';
  if (ch === '\n') return '<CR>';
  if (ch === '\t') return '<Tab>';
  return ch;
}

/** Tokens of pasted or committed text, as if it was typed. Control characters other than line breaks and tabs are dropped. */
export function textTokens(text: string): string[] {
  return [...text.replace(/\r\n?/g, '\n')].filter((ch) => ch === '\n' || ch === '\t' || !/\p{Cc}/u.test(ch)).map(charToken);
}

export function decideKey(e: KeyLike): KeyDecision {
  if (MODIFIERS.has(e.key)) return { kind: 'pass' };
  if (e.metaKey) return { kind: 'pass' };

  // AltGr on Windows arrives as Ctrl+Alt with the produced character (e.g. ą on a Polish layout).
  const altGr = e.ctrlKey && e.altKey && isSingleChar(e.key) && !/^[a-z]$/i.test(e.key);
  if (altGr) return { kind: 'token', token: charToken(e.key) };
  if (e.altKey) return { kind: 'pass' };

  if (e.ctrlKey) {
    let base = e.key;
    // Non-Latin layouts report the local letter; Vim's CTRL keys follow the physical key.
    if (!/^[\x20-\x7e]$/.test(base) && /^Key[A-Z]$/.test(e.code)) base = e.code.slice(3).toLowerCase();
    if (/^[a-z]$/i.test(base)) {
      // Ctrl+Shift+letter is the browser's (developer tools, private window, …).
      if (e.shiftKey) return { kind: 'pass' };
      return { kind: 'token', token: `<C-${base.toLowerCase()}>` };
    }
    if (CTRL_PUNCTUATION.has(base)) return { kind: 'token', token: `<C-${base}>` };
    // Ctrl+Tab, Ctrl+PageDown, Ctrl+= (zoom), Ctrl+0, …
    return { kind: 'pass' };
  }

  const named = NAMED[e.key];
  if (named) {
    if (e.shiftKey && (e.key === 'Tab' || e.key.startsWith('Arrow'))) {
      // Shift+Tab moves focus back; Shift+arrows have no token yet.
      return e.key === 'Tab' ? { kind: 'pass' } : { kind: 'unsupported', name: `Shift+${e.key}` };
    }
    return { kind: 'token', token: named };
  }
  if (isSingleChar(e.key)) return { kind: 'token', token: charToken(e.key) };
  // Function keys stay with the browser (F5 reload, F11 full screen, F12 tools).
  if (/^F\d{1,2}$/.test(e.key)) return { kind: 'pass' };
  // Dead keys, IME processing: the character arrives later as text input.
  if (e.key === 'Dead' || e.key === 'Process' || e.key === 'Unidentified') return { kind: 'pass' };
  // Home, End, PageUp, PageDown, Insert, media keys, …
  return { kind: 'unsupported', name: e.key };
}
