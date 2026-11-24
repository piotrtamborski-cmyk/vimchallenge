import type { Pos, Snapshot } from '@vimchallenge/engine';

export interface Difference {
  field: string;
  vim: unknown;
  cm: unknown;
}

/** Deep equality that ignores object key order (Vim's json_encode orders keys differently). */
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)]))
  : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const posEq = (a: Pos | undefined, b: Pos | undefined) => same(a, b);

/** Fields a person can see after each key: text, mode and (outside the command line) cursor. */
export function stepDifferences(vim: Snapshot, cm: Snapshot, token?: string): Difference[] {
  const out: Difference[] = [];
  if (!same(vim.lines, cm.lines)) out.push({ field: 'text', vim: vim.lines, cm: cm.lines });
  // While waiting for the character after `r`, Vim reports Replace mode (for the cursor shape).
  const pendingReplace = token === 'r' && vim.mode === 'replace' && cm.mode === 'normal';
  if (vim.mode !== cm.mode && !pendingReplace) out.push({ field: 'mode', vim: vim.mode, cm: cm.mode });
  else if (vim.mode !== 'cmdline' && !posEq(vim.cursor, cm.cursor))
    out.push({ field: 'cursor', vim: vim.cursor, cm: cm.cursor });
  return out;
}

/** Full comparison of the final state. Registers recorded with `q` hold engine-specific key codes and are skipped. */
export function finalDifferences(vim: Snapshot, cm: Snapshot, macroRegisters: Set<string>): Difference[] {
  const out = stepDifferences(vim, cm);
  if (!same(vim.visual, cm.visual)) out.push({ field: 'visual', vim: vim.visual, cm: cm.visual });
  const regNames = new Set([...Object.keys(vim.registers), ...Object.keys(cm.registers)]);
  for (const r of [...regNames].sort()) {
    if (macroRegisters.has(r) || r === '"') continue;
    if (!same(vim.registers[r], cm.registers[r]))
      out.push({ field: `register ${r}`, vim: vim.registers[r], cm: cm.registers[r] });
  }
  const markNames = new Set([...Object.keys(vim.marks), ...Object.keys(cm.marks)]);
  for (const m of [...markNames].sort()) {
    if (!posEq(vim.marks[m], cm.marks[m])) out.push({ field: `mark ${m}`, vim: vim.marks[m], cm: cm.marks[m] });
  }
  return out;
}

export interface Expected {
  lines?: string[];
  cursor?: Pos;
  mode?: string;
  visual?: { type: string; from: Pos; to: Pos };
  registers?: Record<string, { type: string; text: string }>;
  marks?: Record<string, Pos>;
}

/** Checks a final state against the goals declared on a card. */
export function goalFailures(s: Snapshot, e: Expected): string[] {
  const out: string[] = [];
  if (e.lines && !same(s.lines, e.lines)) out.push(`text ${JSON.stringify(s.lines)}`);
  if (e.cursor && !posEq(s.cursor, e.cursor)) out.push(`cursor ${JSON.stringify(s.cursor)}`);
  if (e.mode && s.mode !== e.mode) out.push(`mode ${s.mode}`);
  if (e.visual) {
    const v = s.visual;
    const ends = v ? [v.anchor, v.head].map((p) => JSON.stringify(p)).sort() : [];
    const want = [e.visual.from, e.visual.to].map((p) => JSON.stringify(p)).sort();
    if (s.mode !== e.visual.type || !same(ends, want)) out.push(`visual ${s.mode} ${JSON.stringify(v)}`);
  }
  for (const [r, want] of Object.entries(e.registers ?? {}))
    if (!same(s.registers[r], want)) out.push(`register ${r} ${JSON.stringify(s.registers[r])}`);
  for (const [m, want] of Object.entries(e.marks ?? {}))
    if (!posEq(s.marks[m], want)) out.push(`mark ${m} ${JSON.stringify(s.marks[m])}`);
  return out;
}
