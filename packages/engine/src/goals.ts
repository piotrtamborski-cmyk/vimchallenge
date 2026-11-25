import type { InitialState, Pos, Snapshot } from './types.ts';

/** Goals of a task: every field that is present must match the final state. */
export interface Expected {
  lines?: string[];
  cursor?: Pos;
  mode?: string;
  /** Active selection: the mode (visual, visual-line, visual-block) and its two ends in any order. */
  visual?: { type: string; from: Pos; to: Pos };
  registers?: Record<string, { type: string; text: string }>;
  marks?: Record<string, Pos>;
}

/** A task as stored in the bank and replayed by the judge. */
export interface Task {
  id: string;
  version: number;
  title: string;
  /** Markdown-lite: `code` spans only. */
  prompt: string;
  /** One solution in key notation (see keys.ts); checked against reference Vim. */
  keys: string;
  initial: InitialState;
  expected: Expected;
  /** Par time for a fluent player, in seconds. */
  referenceSeconds?: number;
}

/** Deep equality that ignores object key order. */
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)]))
  : v;
export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

export type GoalField = 'text' | 'cursor' | 'mode' | 'visual' | `register ${string}` | `mark ${string}`;

export interface GoalFailure {
  field: GoalField;
  want: unknown;
  got: unknown;
}

/** Checks a final state against the goals declared on a task. */
export function checkGoals(s: Snapshot, e: Expected): GoalFailure[] {
  const out: GoalFailure[] = [];
  if (e.lines && !sameValue(s.lines, e.lines)) out.push({ field: 'text', want: e.lines, got: s.lines });
  if (e.cursor && !sameValue(s.cursor, e.cursor)) out.push({ field: 'cursor', want: e.cursor, got: s.cursor });
  if (e.mode && s.mode !== e.mode) out.push({ field: 'mode', want: e.mode, got: s.mode });
  if (e.visual) {
    const v = s.visual;
    const ends = v ? [v.anchor, v.head].map((p) => JSON.stringify(p)).sort() : [];
    const want = [e.visual.from, e.visual.to].map((p) => JSON.stringify(p)).sort();
    if (s.mode !== e.visual.type || !sameValue(ends, want))
      out.push({ field: 'visual', want: e.visual, got: v ? { type: s.mode, from: v.anchor, to: v.head } : undefined });
  }
  for (const [r, want] of Object.entries(e.registers ?? {}))
    if (!sameValue(s.registers[r], want)) out.push({ field: `register ${r}`, want, got: s.registers[r] });
  for (const [m, want] of Object.entries(e.marks ?? {}))
    if (!sameValue(s.marks[m], want)) out.push({ field: `mark ${m}`, want, got: s.marks[m] });
  return out;
}
