import { checkGoals, sameValue, type Expected, type Pos, type Snapshot } from '@vimchallenge/engine';

export interface Difference {
  field: string;
  vim: unknown;
  cm: unknown;
}

/** Deep equality that ignores object key order (Vim's json_encode orders keys differently). */
const same = sameValue;
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

/** Goal failures as one line each, for the matrix. */
export function goalFailures(s: Snapshot, e: Expected): string[] {
  return checkGoals(s, e).map((f) =>
    f.field === 'visual' ? `visual ${s.mode} ${JSON.stringify(s.visual)}` : `${f.field} ${JSON.stringify(f.got)}`,
  );
}
