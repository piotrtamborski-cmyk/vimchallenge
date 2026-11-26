/** Words for what the editor shows and for goals a run has not met yet, in the player's terms. */
import type { GoalFailure, Pos, StepGoal } from '@vimchallenge/engine';

const MODE_LABEL: Record<string, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  replace: 'REPLACE',
  visual: 'VISUAL',
  'visual-line': 'VISUAL LINE',
  'visual-block': 'VISUAL BLOCK',
  cmdline: 'COMMAND',
};
export const modeLabel = (mode: string) => MODE_LABEL[mode] ?? mode.toUpperCase();
const at = ([line, col]: Pos) => `line ${line}, column ${col}`;

/** One sentence per unmet goal, in the player's terms. */
export function describe(f: GoalFailure): string {
  if (f.field === 'text') return 'The text does not match the goal yet.';
  if (f.field === 'steps') return (f.want as StepGoal).label;
  if (f.field === 'cursor') return `The cursor should be on ${at(f.want as Pos)}; it is on ${at(f.got as Pos)}.`;
  if (f.field === 'mode') return `Finish in ${modeLabel(String(f.want))} mode; you are in ${modeLabel(String(f.got))} mode.`;
  if (f.field === 'visual') {
    const want = f.want as { type: string; from: Pos; to: Pos };
    return `Keep a ${modeLabel(want.type)} selection active from ${at(want.from)} to ${at(want.to)}.`;
  }
  if (f.field.startsWith('register ')) {
    const want = f.want as { text: string };
    return `Register "${f.field.slice(9)} should hold ${JSON.stringify(want.text)}.`;
  }
  const mark = f.field.slice(5);
  return `Mark '${mark} should be on ${at(f.want as Pos)}.`;
}

/** Key log in Vim notation, e.g. `ciwfast<Esc>`. */
export const notation = (keys: readonly string[]) => keys.map((k) => (k === '<' ? '<lt>' : k)).join('');

