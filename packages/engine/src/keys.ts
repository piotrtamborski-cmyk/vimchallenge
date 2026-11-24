/**
 * Key notation used by task authors and by the action log, e.g. `ciwnowy<Esc>` or `:%s/a/b/<CR>`.
 * A token is one engine-level key in Vim notation: a single character, or a special key
 * such as `<Esc>`, `<CR>`, `<Space>` or `<C-v>`. Anything that is not a known special key
 * (for example `\<id\>` inside a pattern) is taken literally, character by character.
 */
const SPECIAL = /^<(CR|Esc|BS|Tab|Space|lt|Del|Up|Down|Left|Right|C-[A-Za-z[\]\\^_@])>/;

export function parseKeys(notation: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < notation.length) {
    if (notation[i] === '<') {
      const m = SPECIAL.exec(notation.slice(i));
      if (m) {
        out.push(normalizeSpecial(m[0]));
        i += m[0].length;
        continue;
      }
    }
    const ch = String.fromCodePoint(notation.codePointAt(i)!);
    out.push(ch === ' ' ? '<Space>' : ch);
    i += ch.length;
  }
  return out;
}

function normalizeSpecial(token: string): string {
  if (token === '<lt>') return '<';
  const ctrl = /^<C-(.)>$/.exec(token);
  if (ctrl) return `<C-${ctrl[1]!.toLowerCase()}>`;
  return token;
}

/** Text that a token inserts when the editor treats it as typed input. */
export function tokenText(token: string): string | undefined {
  if (token === '<Space>') return ' ';
  if (token === '<CR>') return '\n';
  if (token === '<Tab>') return '\t';
  if (token.length > 1 && token.startsWith('<') && token.endsWith('>')) return undefined;
  return token;
}
