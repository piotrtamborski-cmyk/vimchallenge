//@ts-check
// Vim pattern and replacement translation for vim-core (vimchallenge fork). MIT, see LICENSE.
//
// Translates a Vim pattern (`:help pattern`) into JavaScript RegExp source that is valid with the
// `u` flag and keeps Vim's line semantics: classes such as \s, \S and [^x] never match the end of
// a line (only \n and \_x do), and \< \> \k follow the default 'iskeyword' including non-ASCII
// letters. Unsupported items throw a VimPatternError instead of silently matching something else.

export class VimPatternError extends Error {}

// Default 'iskeyword' (@,48-57,_,192-255) plus letters above 255. Vim classifies characters above
// 255 by Unicode class; this approximation keeps everything outside General Punctuation and
// the astral planes. Written without \p{…}: the CodeMirror 6 adapter escapes unknown braces.
const KEYWORD = '0-9A-Za-z_\\u00C0-\\u00FF\\u0100-\\u1FFF\\u2070-\\uFFFF';
const KEYWORD_NO_DIGIT = 'A-Za-z_\\u00C0-\\u00FF\\u0100-\\u1FFF\\u2070-\\uFFFF';
const IDENT = '0-9A-Za-z_\\u00C0-\\u00FF';
const FNAME = '0-9A-Za-z/.\\-_+,#$%~=\\u00C0-\\u00FF';

/** Character class atoms: letter → [chars, negated]. Upper case is the complement. */
const CLASS = {
  s: [' \\t', false], S: [' \\t', true],
  d: ['0-9', false], D: ['0-9', true],
  w: ['0-9A-Za-z_', false], W: ['0-9A-Za-z_', true],
  a: ['A-Za-z', false], A: ['A-Za-z', true],
  l: ['a-z', false], L: ['a-z', true],
  u: ['A-Z', false], U: ['A-Z', true],
  x: ['0-9A-Fa-f', false], X: ['0-9A-Fa-f', true],
  o: ['0-7', false], O: ['0-7', true],
  h: ['A-Za-z_', false], H: ['A-Za-z_', true],
  k: [KEYWORD, false], K: [KEYWORD_NO_DIGIT, false],
  i: [IDENT, false], I: [IDENT.replace('0-9', ''), false],
  f: [FNAME, false], F: [FNAME.replace('0-9', ''), false],
  p: ['\\x00-\\x1f\\x7f', true], P: ['\\x00-\\x1f\\x7f0-9', true],
};

const POSIX = {
  alnum: '0-9A-Za-z', alpha: 'A-Za-z', blank: ' \\t', cntrl: '\\x00-\\x1f\\x7f', digit: '0-9',
  graph: '!-~', lower: 'a-z', print: ' -~', punct: '!-\\/:-@\\[-`{-~', space: ' \\t\\n\\r\\f\\v',
  upper: 'A-Z', xdigit: '0-9A-Fa-f', return: '\\r', tab: '\\t', escape: '\\x1b', backspace: '\\x08',
  ident: IDENT, keyword: KEYWORD, fname: FNAME,
};

const WORD_START = `(?<![${KEYWORD}])(?=[${KEYWORD}])`;
const WORD_END = `(?<=[${KEYWORD}])(?![${KEYWORD}])`;

/** Characters that need a backslash to be literal in JavaScript (all valid escapes with the u flag). */
const JS_SPECIAL = /[\\^$.*+?()[\]{}|/]/;
const lit = (/** @type {string} */ ch) => (JS_SPECIAL.test(ch) ? '\\' + ch : ch);

/** @param {string} chars @param {boolean} negated @param {boolean} withNewline */
function renderClass(chars, negated, withNewline) {
  if (negated) return withNewline ? `[^${chars}]` : `[^${chars}\\n]`;
  return withNewline ? `[${chars}\\n]` : `[${chars}]`;
}

/**
 * @typedef {{ source: string, ignoreCase: boolean | undefined }} TranslatedPattern
 * `ignoreCase` is true for \c, false for \C and undefined when the pattern does not say.
 */

/**
 * @param {string} pattern Vim pattern as typed, without the surrounding delimiters.
 * @param {{ magic?: boolean, lastSubstitute?: string }} [options]
 * @returns {TranslatedPattern}
 */
export function translateVimPattern(pattern, options = {}) {
  /** 'v' very magic, 'm' magic, 'M' nomagic, 'V' very nomagic */
  let mode = options.magic === false ? 'M' : 'm';
  /** @type {boolean | undefined} */
  let ignoreCase;
  /** @type {string[]} */
  const parts = [];
  /** Index in `parts` where the last complete atom starts (-1: none, a quantifier is literal). */
  let atomStart = -1;
  /** Open groups: index of the '(' part. */
  /** @type {number[]} */
  const groups = [];
  /** @type {number | undefined} */
  let zsAt;
  /** @type {number | undefined} */
  let zeAt;
  let i = 0;

  const atBranchStart = () => {
    const last = parts[parts.length - 1];
    return last === undefined || last === '(' || last === '(?:' || last === '|';
  };
  const pushAtom = (/** @type {string} */ text) => {
    atomStart = parts.length;
    parts.push(text);
  };
  const pushQuantifier = (/** @type {string} */ q, /** @type {string} */ raw) => {
    if (atomStart < 0) return pushAtom(lit(raw.replace(/^\\/, '')));
    parts.push(q);
  };
  /** True when `$` at position j ends a branch: end of pattern, before \|, \) or \n. */
  const endsBranch = (/** @type {number} */ j) => {
    if (j >= pattern.length) return true;
    if (mode === 'v' && (pattern[j] === '|' || pattern[j] === ')')) return true;
    return pattern[j] === '\\' && (pattern[j + 1] === '|' || pattern[j + 1] === ')' || pattern[j + 1] === 'n');
  };

  /** Bracket expression starting at pattern[start] === '['. Returns [js, nextIndex] or null if unclosed. */
  const bracket = (/** @type {number} */ start, /** @type {boolean} */ withNewline) => {
    let j = start + 1;
    let negated = false;
    if (pattern[j] === '^') { negated = true; j++; }
    let body = '';
    let first = true;
    while (j < pattern.length) {
      const c = pattern[j];
      if (c === ']' && !first) {
        return /** @type {[string, number]} */ ([renderClass(body, negated, withNewline), j + 1]);
      }
      first = false;
      if (c === '[' && pattern[j + 1] === ':') {
        const end = pattern.indexOf(':]', j + 2);
        const name = end > 0 ? pattern.slice(j + 2, end) : '';
        if (name in POSIX) {
          body += POSIX[/** @type {keyof typeof POSIX} */ (name)];
          j = end + 2;
          continue;
        }
      }
      if (c === '\\') {
        const n = pattern[j + 1];
        const esc = { e: '\\x1b', t: '\\t', r: '\\r', b: '\\x08', n: '\\n', '\\': '\\\\', ']': '\\]', '^': '\\^', '-': '\\-' };
        if (n !== undefined && n in esc) {
          body += esc[/** @type {keyof typeof esc} */ (n)];
          j += 2;
          continue;
        }
        const num = /^(d\d+|o[0-7]+|x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4})/.exec(pattern.slice(j + 1));
        if (num) {
          const kind = num[0][0];
          const digits = num[0].slice(1);
          const code = parseInt(digits, kind === 'd' ? 10 : kind === 'o' ? 8 : 16);
          body += '\\u' + code.toString(16).padStart(4, '0');
          j += 1 + num[0].length;
          continue;
        }
        body += '\\\\'; // a backslash that starts no escape is literal in Vim
        j++;
        continue;
      }
      // A ']' here is literal (first in the set); '[' and '/' need escaping in JS sets too.
      body += c === '[' || c === ']' || c === '/' ? '\\' + c : c;
      j++;
    }
    return null;
  };

  while (i < pattern.length) {
    const c = /** @type {string} */ (pattern[i]);
    if (c === '\\') {
      const n = pattern[i + 1];
      if (n === undefined) { pushAtom('\\\\'); i++; continue; }
      i += 2;
      if (n === 'v' || n === 'm' || n === 'M' || n === 'V') { mode = n; continue; }
      if (n === 'c') { ignoreCase = true; continue; }
      if (n === 'C') { if (ignoreCase === undefined) ignoreCase = false; continue; }
      if (n === 'z') {
        const z = pattern[i];
        i++;
        if (z === 's' || z === 'e') {
          if (groups.length) throw new VimPatternError(`\\z${z} inside a group is not supported`);
          if (z === 's') zsAt = parts.length; else zeAt = parts.length;
          continue;
        }
        throw new VimPatternError(`\\z${z ?? ''} is not supported`);
      }
      if (n === '_') {
        const k = pattern[i];
        i++;
        if (k === '.') { pushAtom('[^]'); continue; }
        if (k === '^') { pushAtom('^'); continue; }
        if (k === '$') { pushAtom('$'); continue; }
        if (k === '[') {
          const r = bracket(i - 1, true);
          if (!r) throw new VimPatternError('unclosed \\_[');
          pushAtom(r[0]);
          i = r[1];
          continue;
        }
        if (k !== undefined && k in CLASS) {
          const [chars, neg] = CLASS[/** @type {keyof typeof CLASS} */ (k)];
          pushAtom(renderClass(chars, neg, true));
          continue;
        }
        throw new VimPatternError(`\\_${k ?? ''} is not supported`);
      }
      if (n in CLASS) {
        // In very magic mode \< and \> are literal; letters are classes in every mode.
        const [chars, neg] = CLASS[/** @type {keyof typeof CLASS} */ (n)];
        pushAtom(renderClass(chars, neg, false));
        continue;
      }
      if (/[1-9]/.test(n)) { pushAtom('\\' + n); continue; }
      const simple = { n: '\\n', t: '\\t', e: '\\x1b', r: '\\r', b: '\\x08' };
      if (n in simple) { pushAtom(simple[/** @type {keyof typeof simple} */ (n)]); continue; }
      // Items that are special after a backslash in magic/nomagic and literal in very magic.
      if (mode !== 'v') {
        if (n === '<') { pushAtom(WORD_START); continue; }
        if (n === '>') { pushAtom(WORD_END); continue; }
        if (special(n)) continue;
      }
      // Items that are special after a backslash only in nomagic / very nomagic.
      if (mode === 'M' || mode === 'V') {
        if (n === '.') { pushAtom('.'); continue; }
        if (n === '*') { pushQuantifier('*', '\\*'); continue; }
        if (n === '[') { if (openBracket(false)) continue; }
        if (n === '~') { pushAtom(lastSub()); continue; }
      }
      pushAtom(lit(n));
      continue;
    }
    i++;
    if (c === '^' && atBranchStart() && mode !== 'V') { parts.push('^'); atomStart = -1; continue; }
    if (c === '^' && mode === 'V' && parts.length === 0) { parts.push('^'); atomStart = -1; continue; }
    if (c === '$' && endsBranch(i) && (mode !== 'V' || i === pattern.length)) { parts.push('$'); continue; }
    if (mode === 'v') {
      if (c === '<') { pushAtom(WORD_START); continue; }
      if (c === '>') { pushAtom(WORD_END); continue; }
      i--;
      const handled = special(c, true);
      if (handled) continue;
      i++;
    }
    if (mode === 'v' || mode === 'm') {
      if (c === '.') { pushAtom('.'); continue; }
      if (c === '*') { pushQuantifier('*', '*'); continue; }
      if (c === '[') { i--; if (openBracket(false, true)) continue; i++; }
      if (c === '~') { pushAtom(lastSub()); continue; }
    }
    pushAtom(lit(c));
  }

  /**
   * Group, alternation, quantifier and lookaround items (\( \) \| \+ \= \? \{ \@ \%( in magic,
   * the same without backslash in very magic). With `bare`, `i` points at the item itself.
   * @param {string} n @param {boolean} [bare]
   */
  function special(n, bare = false) {
    if (bare) i++;
    if (n === '(') { groups.push(parts.length); parts.push('('); atomStart = -1; return true; }
    if (n === '%' && pattern[i] === '(') {
      i++;
      groups.push(parts.length);
      parts.push('(?:');
      atomStart = -1;
      return true;
    }
    if (n === ')') {
      const open = groups.pop();
      if (open === undefined) throw new VimPatternError('unmatched \\)');
      parts.push(')');
      atomStart = open;
      return true;
    }
    if (n === '|') { parts.push('|'); atomStart = -1; return true; }
    if (n === '&') throw new VimPatternError('\\& (concat) is not supported');
    if (n === '+') { pushQuantifier('+', '+'); return true; }
    if (n === '=' || n === '?') { pushQuantifier('?', n); return true; }
    if (n === '{') { quantifierBraces(); return true; }
    if (n === '@') { lookaround(); return true; }
    if (n === '%') throw new VimPatternError(`\\%${pattern[i] ?? ''} is not supported`);
    if (bare) i--;
    return false;
  }

  /** @param {boolean} withNewline @param {boolean} [bare] */
  function openBracket(withNewline, bare = false) {
    const start = bare ? i : i - 1;
    const r = bracket(start, withNewline);
    if (!r) return false;
    pushAtom(r[0]);
    i = r[1];
    return true;
  }

  function quantifierBraces() {
    const m = /^(-?)(\d*)(,?)(\d*)\\?\}/.exec(pattern.slice(i));
    if (!m) throw new VimPatternError('invalid \\{…}');
    i += m[0].length;
    const [, lazy, from, comma, to] = m;
    let q;
    if (!from && !to) q = '*';
    else if (!comma) q = `{${from}}`;
    else q = `{${from || '0'},${to}}`;
    if (lazy && q !== `{${from}}`) q += '?';
    pushQuantifier(q, '{');
  }

  function lookaround() {
    const m = /^(=|!|>|<=|<!|\d*<=|\d*<!)/.exec(pattern.slice(i));
    if (!m || atomStart < 0) throw new VimPatternError('invalid \\@');
    i += m[0].length;
    const kind = m[0].replace(/^\d+/, '');
    const atom = parts.splice(atomStart).join('');
    const open = { '=': '(?=', '!': '(?!', '>': '(?:', '<=': '(?<=', '<!': '(?<!' }[kind];
    pushAtom(`${open}${atom})`);
  }

  function lastSub() {
    if (options.lastSubstitute === undefined) throw new VimPatternError('~ without a previous substitute string');
    return options.lastSubstitute.split('').map(lit).join('');
  }

  if (groups.length) throw new VimPatternError('unmatched \\(');
  let source = parts.join('');
  if (zsAt !== undefined || zeAt !== undefined) {
    const s = zsAt ?? 0;
    const e = zeAt ?? parts.length;
    const before = parts.slice(0, s).join('');
    const body = parts.slice(s, Math.max(s, e)).join('');
    const after = parts.slice(Math.max(s, e)).join('');
    source = (before ? `(?<=${before})` : '') + body + (after ? `(?=${after})` : '');
  }
  return { source, ignoreCase };
}

/** True when the pattern contains an upper case letter that is not part of an escape ('smartcase'). */
export function patternHasUppercase(/** @type {string} */ pattern) {
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\') { i++; continue; }
    const ch = /** @type {string} */ (pattern[i]);
    if (ch !== ch.toLowerCase() && ch === ch.toUpperCase()) return true;
  }
  return false;
}

/**
 * Compiles a Vim substitute string (`:help sub-replace-special`) into a function of the match.
 * Supports & \0-\9 ~ \u \U \l \L \e \E \r \n \t \\ and literal escapes; \= is not supported.
 * @param {string} template
 * @param {{ magic?: boolean, previous?: string }} [options] previous: the last substitute string, for ~
 * @returns {{ expand: (groups: ArrayLike<string | undefined>) => string, template: string }}
 */
export function compileVimReplacement(template, options = {}) {
  const magic = options.magic !== false;
  // ~ (magic) or \~ (nomagic) is replaced by the previous substitute string before anything else.
  let expanded = '';
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    if (c === '\\' && i + 1 < template.length) {
      if (!magic && template[i + 1] === '~') { expanded += options.previous ?? ''; i++; continue; }
      expanded += c + template[i + 1];
      i++;
      continue;
    }
    if (c === '~' && magic) { expanded += options.previous ?? ''; continue; }
    expanded += c;
  }

  /** @typedef {{ text: string } | { group: number } | { caseOp: 'u' | 'l' | 'U' | 'L' | 'E' }} Op */
  /** @type {Op[]} */
  const ops = [];
  const text = (/** @type {string} */ t) => {
    const last = ops[ops.length - 1];
    if (last && 'text' in last) last.text += t; else ops.push({ text: t });
  };
  for (let i = 0; i < expanded.length; i++) {
    const c = /** @type {string} */ (expanded[i]);
    if (c === '\\' && i + 1 < expanded.length) {
      const n = /** @type {string} */ (expanded[++i]);
      if (/[0-9]/.test(n)) ops.push({ group: Number(n) });
      else if (n === '&') { if (magic) text('&'); else ops.push({ group: 0 }); }
      else if (n === 'u' || n === 'l' || n === 'U' || n === 'L') ops.push({ caseOp: n });
      else if (n === 'e' || n === 'E') ops.push({ caseOp: 'E' });
      else if (n === 'r' || n === '\r') text('\n');
      else if (n === 'n') text('\0');
      else if (n === 't') text('\t');
      else if (n === '=') throw new VimPatternError('\\= expressions are not supported');
      else text(n);
      continue;
    }
    if (c === '&' && magic) { ops.push({ group: 0 }); continue; }
    if (c === '\r') { text('\n'); continue; }
    text(c);
  }

  /** @param {ArrayLike<string | undefined>} groups */
  function expand(groups) {
    let out = '';
    /** @type {'u' | 'l' | null} */
    let once = null;
    /** @type {'U' | 'L' | null} */
    let lasting = null;
    const emit = (/** @type {string} */ s) => {
      for (const ch of s) {
        if (once) { out += once === 'u' ? ch.toUpperCase() : ch.toLowerCase(); once = null; }
        else if (lasting) out += lasting === 'U' ? ch.toUpperCase() : ch.toLowerCase();
        else out += ch;
      }
    };
    for (const op of ops) {
      if ('text' in op) emit(op.text);
      else if ('group' in op) emit(groups[op.group] ?? '');
      else if (op.caseOp === 'u' || op.caseOp === 'l') once = op.caseOp;
      else if (op.caseOp === 'E') { lasting = null; once = null; }
      else lasting = op.caseOp;
    }
    return out;
  }
  return { expand, template: expanded };
}

/** Escapes text so that a magic Vim pattern matches it literally. */
export function escapeVimPattern(/** @type {string} */ text) {
  return text.replace(/[\\.*[~^$/]/g, '\\$&');
}
