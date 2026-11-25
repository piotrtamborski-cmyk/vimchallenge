'use client';

import { checkGoals, type GoalFailure, type Pos, type Snapshot, type Task } from '@vimchallenge/engine';
import type { BrowserEditor } from '@vimchallenge/engine/browser';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Prompt } from './Prompt';

const MODE_LABEL: Record<string, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  replace: 'REPLACE',
  visual: 'VISUAL',
  'visual-line': 'VISUAL LINE',
  'visual-block': 'VISUAL BLOCK',
  cmdline: 'COMMAND',
};
const modeLabel = (mode: string) => MODE_LABEL[mode] ?? mode.toUpperCase();
const at = ([line, col]: Pos) => `line ${line}, column ${col}`;

interface Result {
  passed: boolean;
  failures: GoalFailure[];
  keys: number;
}

/** One sentence per unmet goal, in the player's terms. */
function describe(f: GoalFailure): string {
  if (f.field === 'text') return 'The text does not match the goal yet.';
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
const notation = (keys: readonly string[]) => keys.map((k) => (k === '<' ? '<lt>' : k)).join('');

export function TaskPlayer({ task, nextHref, autofocus = true }: { task: Task; nextHref?: string; autofocus?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<BrowserEditor | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [keys, setKeys] = useState<readonly string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hint, setHint] = useState(false);

  const check = useCallback(
    (state?: Snapshot) => {
      const ed = editor.current;
      if (!ed) return;
      const failures = checkGoals(state ?? ed.snapshot(), task.expected);
      setResult({ passed: failures.length === 0, failures, keys: ed.log().length });
    },
    [task],
  );

  useEffect(() => {
    let cancelled = false;
    let ed: BrowserEditor | undefined;
    // The editor is loaded on demand, only on pages with a task.
    void import('@vimchallenge/engine/browser').then(({ mountEditor }) => {
      if (cancelled || !host.current) return;
      ed = mountEditor(host.current, {
        initial: task.initial,
        autofocus: autofocus || attempt > 0,
        onKey(_token, state) {
          setSnapshot(state);
          setKeys([...ed!.log()]);
          setNotice(null);
          setResult(null);
        },
        onSubmit: (state) => check(state),
        onRejected: setNotice,
      });
      editor.current = ed;
      setSnapshot(ed.snapshot());
      setKeys([]);
    });
    return () => {
      cancelled = true;
      ed?.destroy();
      editor.current = null;
    };
  }, [task, attempt, autofocus, check]);

  const restart = () => {
    setResult(null);
    setNotice(null);
    setAttempt((n) => n + 1);
  };

  return (
    <section aria-labelledby={`task-${task.id}`} className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-4">
        <h1 id={`task-${task.id}`} className="text-2xl font-semibold">
          {task.title}
        </h1>
        <Prompt text={task.prompt} className="text-lg leading-relaxed" />
        <div className="flex flex-wrap gap-2 text-sm">
          <button type="button" onClick={() => setHint((h) => !h)} className="rounded border border-line px-3 py-1.5 hover:bg-line/40" aria-expanded={hint}>
            {hint ? 'Hide hint' : 'Hint'}
          </button>
        </div>
        {hint && (
          <p className="text-muted">
            One solution: <kbd className="rounded bg-line/50 px-1.5 py-0.5 font-mono text-ink">{task.keys}</kbd>
          </p>
        )}
      </div>

      <div className="space-y-3">
        <div ref={host} className="vc-editor min-h-28" />
        <div className="flex items-center justify-between font-mono text-sm text-muted" aria-live="off">
          <span>
            <span className="font-semibold text-ink">{snapshot ? `-- ${modeLabel(snapshot.mode)} --` : 'Loading editor…'}</span>
          </span>
          {snapshot && <span>{snapshot.cursor.join(':')}</span>}
        </div>
        <p className="min-h-6 overflow-x-auto whitespace-nowrap font-mono text-sm" aria-label="Keys typed">
          <span className="text-muted">{keys.length} {keys.length === 1 ? 'key' : 'keys'}</span>{' '}
          {notation(keys.slice(-60))}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            // Keep focus (and the current mode) in the editor while clicking.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => check()}
            className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink"
          >
            Check
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={restart}
            className="rounded border border-line px-4 py-2 hover:bg-line/40"
          >
            Start over
          </button>
          <span className="text-sm text-muted">
            <kbd className="font-mono">Esc</kbd> then <kbd className="font-mono">Tab</kbd> leaves the editor ·{' '}
            <kbd className="font-mono">Alt+Enter</kbd> checks without leaving the mode
          </span>
        </div>

        <div role="status" className="min-h-6">
          {notice && <p className="text-bad">{notice}</p>}
          {result?.passed && (
            <p className="font-semibold text-good">
              Solved in {result.keys} {result.keys === 1 ? 'key' : 'keys'}.{' '}
              {nextHref && (
                <Link href={nextHref} className="underline">
                  Next task →
                </Link>
              )}
            </p>
          )}
          {result && !result.passed && (
            <div className="space-y-2">
              <p className="font-semibold text-bad">Not yet.</p>
              <ul className="list-inside list-disc space-y-1">
                {result.failures.map((f) => (
                  <li key={f.field}>{describe(f)}</li>
                ))}
              </ul>
              {result.failures.some((f) => f.field === 'text') && <TextDiff want={task.expected.lines!} got={snapshot?.lines ?? []} />}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TextDiff({ want, got }: { want: string[]; got: string[] }) {
  const block = (title: string, lines: string[]) => (
    <figure className="min-w-0 flex-1">
      <figcaption className="text-sm text-muted">{title}</figcaption>
      <pre className="overflow-x-auto rounded border border-line bg-panel p-2 font-mono text-sm">{lines.join('\n')}</pre>
    </figure>
  );
  return (
    <div className="flex flex-wrap gap-3">
      {block('Goal', want)}
      {block('Now', got)}
    </div>
  );
}
