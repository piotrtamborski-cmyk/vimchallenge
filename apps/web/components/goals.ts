/**
 * Words for what the editor shows and for goals a run has not met yet, in the player's terms.
 * Mode names stay as Vim shows them (`-- INSERT --`), in every language.
 */
import type { GoalFailure, Pos, StepGoal } from '@vimchallenge/engine';
import type { Rejection } from '@vimchallenge/engine/browser';
import type { I18n } from '@/lib/i18n/i18n';
import type { ClientMessages } from '@/lib/i18n/messages';
import type { NotConfirmed, Unavailable } from '@/lib/server-check';

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

/** One sentence per unmet goal, in the player's terms and language. */
export function describe(f: GoalFailure, i: I18n<ClientMessages>): string {
  const g = i.m.goals;
  const at = ([line, col]: Pos) => i.t(g.at, { line, col });
  if (f.field === 'text') return g.text;
  if (f.field === 'steps') return (f.want as StepGoal).label;
  if (f.field === 'cursor') return i.t(g.cursor, { want: at(f.want as Pos), got: at(f.got as Pos) });
  if (f.field === 'mode') return i.t(g.mode, { want: modeLabel(String(f.want)), got: modeLabel(String(f.got)) });
  if (f.field === 'visual') {
    const want = f.want as { type: string; from: Pos; to: Pos };
    return i.t(g.visual, { type: modeLabel(want.type), from: at(want.from), to: at(want.to) });
  }
  if (f.field.startsWith('register ')) {
    const want = f.want as { text: string };
    return i.t(g.register, { name: f.field.slice(9), text: JSON.stringify(want.text) });
  }
  return i.t(g.mark, { name: f.field.slice(5), at: at(f.want as Pos) });
}

/** Key log in Vim notation, e.g. `ciwfast<Esc>`. */
export const notation = (keys: readonly string[]) => keys.map((k) => (k === '<' ? '<lt>' : k)).join('');


/** What the editor says when it refuses input. */
export function rejectionText(r: Rejection, i: I18n<ClientMessages>): string {
  const e = i.m.editor;
  if (r.code === 'unsupported') return i.t(e.unsupported, { name: r.name });
  if (r.code === 'paste-off') return e.pasteOff;
  if (r.code === 'paste-mode') return e.pasteMode;
  return i.t(e.keyError, { key: r.key, detail: r.detail });
}

/** Why the server's judge did not confirm a solve, or could not check it. */
export function serverCheckText(reason: NotConfirmed | Unavailable, i: I18n<ClientMessages>, wait?: number): string {
  return i.t(i.m.serverCheck[reason], { n: wait ?? 60 });
}
