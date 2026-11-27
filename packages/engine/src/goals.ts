import { parseKeys } from './keys.ts';
import type { Change, HistoryMove, InitialState, Pos, Snapshot, Step } from './types.ts';

/** Goals of a task: every field that is present must match the final state. */
export interface Expected {
  lines?: string[];
  cursor?: Pos;
  mode?: string;
  /** Active selection: the mode (visual, visual-line, visual-block) and its two ends in any order. */
  visual?: { type: string; from: Pos; to: Pos };
  registers?: Record<string, { type: string; text: string }>;
  marks?: Record<string, Pos>;
  /**
   * How the task must be solved: steps of the trail that must occur in this order (not
   * necessarily one right after another). Each present field must hold for the same key.
   */
  steps?: StepGoal[];
}

/** One step the player must take on the way, e.g. "visit the end of the file before the first edit". */
export interface StepGoal {
  /** Shown to the player while the step is missing. */
  label: string;
  /** What the key did to the text. */
  change?: Change;
  /** Text before the key. */
  from?: string[];
  /** Text after the key. */
  lines?: string[];
  /** Cursor after the key. */
  cursor?: Pos;
  /** Line of the cursor after the key, at any column. */
  line?: number;
  /** Mode after the key. */
  mode?: string;
  /** Mode the key was pressed in. */
  fromMode?: string;
  /** Marks after the key (other marks may be set too). */
  marks?: Record<string, Pos>;
  /**
   * The keys so far end with one of these, in key notation: `.` for a repeat, `@q` for playing a
   * macro (a count before it is fine). Proves which command made the step, not just its result.
   */
  keys?: string[];
  /**
   * The key changed at least this many lines at once and kept their number: a block insert,
   * change or delete reaches every line of the block in one key, typing or deleting line by line
   * never does. (Vim fills the other lines of a block insert when it ends, the editor while typing;
   * both pass when this is one less than the height of the block.)
   */
  linesAtOnce?: number;
  /** No key so far, this one included, has changed the text. */
  beforeFirstEdit?: boolean;
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
  /** The same technique on other texts ("practise on new text"); text 1 is the task itself. */
  variants?: TaskVariant[];
}

/** Another text for a task: what differs from the task's first text. Title and version are the task's. */
export interface TaskVariant {
  prompt: string;
  keys: string;
  initial: InitialState;
  expected: Expected;
}

/** Deep equality that ignores object key order. */
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)]))
  : v;
export const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

export type GoalField = 'text' | 'cursor' | 'mode' | 'visual' | `register ${string}` | `mark ${string}` | 'steps';

export interface GoalFailure {
  field: GoalField;
  want: unknown;
  got: unknown;
}

/**
 * What a key did, from the text before and after it and the history move the engine reported.
 * Shared by the engine and the reference Vim runner, so both classify keys the same way.
 */
export function classifyChange(before: string[], after: string[], move: HistoryMove): Change | undefined {
  if (move) return move;
  return sameValue(before, after) ? undefined : 'edit';
}

/**
 * Checks a trail (the initial state, then the state after every key) against the goals of a task:
 * the final state, and the steps it must have taken on the way.
 */
export function checkGoals(trail: readonly Step[], e: Expected): GoalFailure[] {
  const s = trail[trail.length - 1]!.snapshot;
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
  const missing = missingStep(trail, e.steps ?? []);
  if (missing) out.push({ field: 'steps', want: missing, got: undefined });
  return out;
}

/**
 * The first step goal the trail does not reach, if any. Goals are matched in order, each on a
 * later key than the one before; taking the earliest match for each goal is always optimal.
 */
function missingStep(trail: readonly Step[], goals: StepGoal[]): StepGoal | undefined {
  let g = 0;
  let edited = false;
  const tokens: string[] = [];
  const endings = goals.map((goal) => goal.keys?.map(parseKeys));
  for (let i = 0; i < trail.length && g < goals.length; i++) {
    const step = trail[i]!;
    if (i > 0) tokens.push(step.token ?? '');
    if (i > 0 && !sameValue(step.snapshot.lines, trail[i - 1]!.snapshot.lines)) edited = true;
    if (stepMatches(goals[g]!, endings[g], tokens, step, trail[i - 1], edited)) g++;
  }
  return goals[g];
}

const endsWith = (tokens: readonly string[], end: readonly string[]) =>
  end.length > 0 && end.length <= tokens.length && end.every((t, i) => tokens[tokens.length - end.length + i] === t);

/** Lines that differ between two texts of the same length; none when the number of lines changed. */
function changedLines(before: readonly string[], after: readonly string[]): number {
  if (before.length !== after.length) return 0;
  return after.filter((l, i) => l !== before[i]).length;
}

function stepMatches(
  goal: StepGoal,
  endings: string[][] | undefined,
  tokens: readonly string[],
  step: Step,
  prev: Step | undefined,
  edited: boolean,
): boolean {
  if (goal.change && step.change !== goal.change) return false;
  if (goal.from && (!prev || !sameValue(prev.snapshot.lines, goal.from))) return false;
  if (goal.lines && !sameValue(step.snapshot.lines, goal.lines)) return false;
  if (goal.cursor && !sameValue(step.snapshot.cursor, goal.cursor)) return false;
  if (goal.line !== undefined && step.snapshot.cursor[0] !== goal.line) return false;
  if (goal.mode && step.snapshot.mode !== goal.mode) return false;
  if (goal.fromMode && prev?.snapshot.mode !== goal.fromMode) return false;
  for (const [m, at] of Object.entries(goal.marks ?? {})) if (!sameValue(step.snapshot.marks[m], at)) return false;
  if (endings && !endings.some((end) => endsWith(tokens, end))) return false;
  if (goal.linesAtOnce !== undefined && (!prev || changedLines(prev.snapshot.lines, step.snapshot.lines) < goal.linesAtOnce)) return false;
  if (goal.beforeFirstEdit && edited) return false;
  return true;
}
