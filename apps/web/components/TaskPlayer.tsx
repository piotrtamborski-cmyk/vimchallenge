'use client';

import { checkGoals, type GoalFailure, type Pos, type Snapshot, type Step, type StepGoal, type Task } from '@vimchallenge/engine';
import type { BrowserEditor } from '@vimchallenge/engine/browser';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { lessonsFor, type LessonLink, type TaskLessons } from '@/lib/failure-lessons';
import { confirmOnServer, type ServerCheck } from '@/lib/server-check';
import { useNonce } from './Nonce';
import { CodeText, Prompt } from './Prompt';
import { SignInLink } from './SignInLink';

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
const notation = (keys: readonly string[]) => keys.map((k) => (k === '<' ? '<lt>' : k)).join('');

interface TaskPlayerProps {
  /** The task on the text being played (see `onText`). */
  task: Task;
  /** Which text of the task this is, how many it has, and where the next one is. */
  text?: { n: number; count: number; nextHref: string };
  /** Where "next" leads after a solve: the next task, exercise or lesson. */
  next?: { href: string; label: string };
  /** Lessons offered when an attempt fails: the task's own, and those of the unmet goals. */
  lessons?: TaskLessons;
  /** The signed-in player's earlier solves of this task. */
  progress?: { best: number; solves: number };
  autofocus?: boolean;
}

export function TaskPlayer({ task, text, next, lessons, progress, autofocus = true }: TaskPlayerProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<BrowserEditor | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [keys, setKeys] = useState<readonly string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [server, setServer] = useState<ServerCheck | null>(null);
  const serverRequest = useRef<AbortController | null>(null);
  const nonce = useNonce();

  /** Forgets the server's answer about an earlier state of the run. */
  const resetServer = useCallback(() => {
    serverRequest.current?.abort();
    serverRequest.current = null;
    setServer(null);
  }, []);

  const check = useCallback(
    (trail?: readonly Step[]) => {
      const ed = editor.current;
      if (!ed) return;
      // The whole run is judged: some tasks require steps on the way (an undo, a visit to the end).
      const failures = checkGoals(trail ?? ed.trail(), task.expected);
      setResult({ passed: failures.length === 0, failures, keys: ed.log().length });
      resetServer();
      if (failures.length) return;
      // A solve is confirmed by the server's judge, which replays the same key log.
      const request = new AbortController();
      serverRequest.current = request;
      setServer({ state: 'checking' });
      confirmOnServer(task, text?.n ?? 1, [...ed.log()], request.signal).then(
        (answer) => !request.signal.aborted && setServer(answer),
        () => {},
      );
    },
    [task, text?.n, resetServer],
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
        cspNonce: nonce,
        onKey(step) {
          setSnapshot(step.snapshot);
          setKeys([...ed!.log()]);
          setNotice(null);
          setResult(null);
          resetServer();
        },
        onSubmit: (trail) => check(trail),
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
      resetServer();
    };
  }, [task, attempt, autofocus, check, resetServer, nonce]);

  const restart = () => {
    setResult(null);
    setNotice(null);
    resetServer();
    setAttempt((n) => n + 1);
  };

  return (
    <section aria-labelledby={`task-${task.id}`} className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="space-y-4">
        <h1 id={`task-${task.id}`} className="text-2xl font-semibold">
          {task.title}
        </h1>
        {((text && text.count > 1) || progress) && (
          <p className="text-sm text-muted">
            {text && text.count > 1 && `Text ${text.n} of ${text.count}`}
            {text && text.count > 1 && progress && ' · '}
            {progress && `You solved this task ${progress.solves === 1 ? 'once' : `${progress.solves} times`}, in ${progress.best} ${progress.best === 1 ? 'key' : 'keys'} at best`}
          </p>
        )}
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
            <div className="space-y-1">
              <p className="font-semibold text-good">
                Solved in {result.keys} {result.keys === 1 ? 'key' : 'keys'}.{' '}
                {next && (
                  <Link href={next.href} className="underline">
                    {next.label}
                  </Link>
                )}
              </p>
              {text && text.count > 1 && (
                <p>
                  <Link href={text.nextHref} className="underline">
                    Practise on new text →
                  </Link>
                </p>
              )}
              {server && <ServerStatus check={server} />}
            </div>
          )}
          {result && !result.passed && (
            <div className="space-y-2">
              <p className="font-semibold text-bad">Not yet.</p>
              <ul className="list-inside list-disc space-y-1">
                {result.failures.map((f) => (
                  <li key={f.field}>
                    <CodeText text={describe(f)} />
                  </li>
                ))}
              </ul>
              {result.failures.some((f) => f.field === 'text') && <TextDiff want={task.expected.lines!} got={snapshot?.lines ?? []} />}
              <Stuck lessons={lessonsFor(result.failures, lessons)} />
              {text && text.count > 1 && (
                <p className="text-sm">
                  <Link href={text.nextHref} className="underline">
                    Or try it on new text →
                  </Link>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** What the server's judge said about a solve. */
function ServerStatus({ check }: { check: ServerCheck }) {
  if (check.state === 'checking') return <p className="text-sm text-muted">Confirming on the server…</p>;
  if (check.state === 'confirmed' && check.saved)
    return <p className="text-sm text-muted">Confirmed by the server, which replayed your keys, and saved to your progress.</p>;
  if (check.state === 'confirmed')
    return (
      <p className="text-sm text-muted">
        Confirmed by the server, which replayed your keys. Nothing is stored:{' '}
        <SignInLink className="underline">sign in</SignInLink> to keep your progress.
      </p>
    );
  if (check.state === 'not-confirmed') return <p className="text-sm text-bad">The server did not confirm this solve. {check.detail}</p>;
  return <p className="text-sm text-muted">Not confirmed on the server. {check.detail}</p>;
}

/** "Stuck? The lessons A and B explain the keys for this." */
function Stuck({ lessons }: { lessons: LessonLink[] }) {
  if (!lessons.length) return null;
  return (
    <p className="text-sm">
      Stuck? The {lessons.length === 1 ? 'lesson' : 'lessons'}{' '}
      {lessons.map((l, i) => (
        <Fragment key={l.href}>
          {i > 0 && (i === lessons.length - 1 ? ' and ' : ', ')}
          <Link href={l.href} className="underline">
            {l.title}
          </Link>
        </Fragment>
      ))}{' '}
      {lessons.length === 1 ? 'explains' : 'explain'} the keys for this.
    </p>
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
