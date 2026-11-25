import { checkGoals, sameValue, type Change, type Expected, type Pos, type Snapshot, type Step, type StepGoal } from '@vimchallenge/engine';

export interface Difference {
  field: string;
  vim: unknown;
  cm: unknown;
}

/** Deep equality that ignores object key order (Vim's json_encode orders keys differently). */
const same = sameValue;
const posEq = (a: Pos | undefined, b: Pos | undefined) => same(a, b);

/**
 * After each key: what a person can see — text, mode and (outside the command line) cursor — and
 * whether the key was an undo or a redo, which step goals are judged on. An `edit` follows from
 * the text, which is compared already (after this key or the one before).
 */
export function stepDifferences(vim: Step, cm: Step): Difference[] {
  const out = visibleDifferences(vim.snapshot, cm.snapshot, vim.token);
  if (historyMove(vim.change) !== historyMove(cm.change))
    out.push({ field: 'change', vim: vim.change ?? null, cm: cm.change ?? null });
  return out;
}

const historyMove = (c: Change | undefined) => (c === 'undo' || c === 'redo' ? c : null);

function visibleDifferences(vim: Snapshot, cm: Snapshot, token?: string): Difference[] {
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
  const out = visibleDifferences(vim, cm);
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
export function goalFailures(trail: readonly Step[], e: Expected): string[] {
  const s = trail[trail.length - 1]!.snapshot;
  return checkGoals(trail, e).map((f) =>
    f.field === 'visual' ? `visual ${s.mode} ${JSON.stringify(s.visual)}`
    : f.field === 'steps' ? `step missing: ${(f.want as StepGoal).label}`
    : `${f.field} ${JSON.stringify(f.got)}`,
  );
}
