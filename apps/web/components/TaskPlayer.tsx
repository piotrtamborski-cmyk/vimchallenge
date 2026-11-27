'use client';

import { checkGoals, type GoalFailure, type Snapshot, type Step, type Task } from '@vimchallenge/engine';
import type { BrowserEditor, Rejection } from '@vimchallenge/engine/browser';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { lessonsFor, type LessonLink, type TaskLessons } from '@/lib/failure-lessons';
import { linkList } from '@/lib/i18n/links';
import { confirmOnServer, type ServerCheck } from '@/lib/server-check';
import { useNonce } from './Nonce';
import { describe, modeLabel, notation, rejectionText, serverCheckText } from './goals';
import { useI18n } from './I18n';
import { CodeText, Prompt } from './Prompt';
import { SignInLink } from './SignInLink';

interface Result {
  passed: boolean;
  failures: GoalFailure[];
  keys: number;
}

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
  const [notice, setNotice] = useState<Rejection | null>(null);
  const [hint, setHint] = useState(false);
  const [server, setServer] = useState<ServerCheck | null>(null);
  const serverRequest = useRef<AbortController | null>(null);
  const nonce = useNonce();
  const i = useI18n();
  const { m, t } = i;

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
            {text && text.count > 1 && t(m.task.textOf, { n: text.n, count: text.count })}
            {text && text.count > 1 && progress && ' · '}
            {progress && t(m.task.solvedBefore, { n: progress.solves, best: t(m.common.keys, { n: progress.best }) })}
          </p>
        )}
        <Prompt text={task.prompt} className="text-lg leading-relaxed" />
        <div className="flex flex-wrap gap-2 text-sm">
          <button type="button" onClick={() => setHint((h) => !h)} className="rounded border border-line px-3 py-1.5 hover:bg-line/40" aria-expanded={hint}>
            {hint ? m.task.hideHint : m.task.hint}
          </button>
        </div>
        {hint && (
          <p className="text-muted">
            {m.task.oneSolution} <kbd className="rounded bg-line/50 px-1.5 py-0.5 font-mono text-ink">{task.keys}</kbd>
          </p>
        )}
      </div>

      <div className="space-y-3">
        <div ref={host} className="vc-editor min-h-28" />
        <div className="flex items-center justify-between font-mono text-sm text-muted" aria-live="off">
          <span>
            <span className="font-semibold text-ink">{snapshot ? `-- ${modeLabel(snapshot.mode)} --` : m.common.loadingEditor}</span>
          </span>
          {snapshot && <span>{snapshot.cursor.join(':')}</span>}
        </div>
        <p className="min-h-6 overflow-x-auto whitespace-nowrap font-mono text-sm" aria-label={m.common.keysTyped}>
          <span className="text-muted">{t(m.common.keys, { n: keys.length })}</span>{' '}
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
            {m.common.check}
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={restart}
            className="rounded border border-line px-4 py-2 hover:bg-line/40"
          >
            {m.task.startOver}
          </button>
          <span className="text-sm text-muted">
            {i.rich(m.task.leaveEditor, { kbd })} · {i.rich(m.common.altEnter, { kbd })}
          </span>
        </div>

        <div role="status" className="min-h-6">
          {notice && <p className="text-bad">{rejectionText(notice, i)}</p>}
          {result?.passed && (
            <div className="space-y-1">
              <p className="font-semibold text-good">
                {t(m.task.solvedIn, { n: result.keys })}{' '}
                {next && (
                  <Link href={next.href} className="underline">
                    {next.label}
                  </Link>
                )}
              </p>
              {text && text.count > 1 && (
                <p>
                  <Link href={text.nextHref} className="underline">
                    {m.task.practiseAnother}
                  </Link>
                </p>
              )}
              {server && <ServerStatus check={server} />}
            </div>
          )}
          {result && !result.passed && (
            <div className="space-y-2">
              <p className="font-semibold text-bad">{m.common.notYet}</p>
              <ul className="list-inside list-disc space-y-1">
                {result.failures.map((f) => (
                  <li key={f.field}>
                    <CodeText text={describe(f, i)} />
                  </li>
                ))}
              </ul>
              {result.failures.some((f) => f.field === 'text') && <TextDiff want={task.expected.lines!} got={snapshot?.lines ?? []} />}
              <Stuck lessons={lessonsFor(result.failures, lessons)} />
              {text && text.count > 1 && (
                <p className="text-sm">
                  <Link href={text.nextHref} className="underline">
                    {m.task.tryAnother}
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

const kbd = (text: React.ReactNode) => <kbd className="font-mono">{text}</kbd>;

/** What the server's judge said about a solve. */
function ServerStatus({ check }: { check: ServerCheck }) {
  const i = useI18n();
  const { m } = i;
  if (check.state === 'checking') return <p className="text-sm text-muted">{m.task.confirming}</p>;
  if (check.state === 'confirmed' && check.saved) return <p className="text-sm text-muted">{m.task.confirmedSaved}</p>;
  if (check.state === 'confirmed')
    return (
      <p className="text-sm text-muted">
        {i.rich(m.task.confirmed, { signin: (text) => <SignInLink className="underline">{text}</SignInLink> })}
      </p>
    );
  if (check.state === 'not-confirmed') return <p className="text-sm text-bad">{i.t(m.task.notConfirmed, { detail: serverCheckText(check.reason, i) })}</p>;
  return <p className="text-sm text-muted">{i.t(m.task.unavailable, { detail: serverCheckText(check.reason, i, check.wait) })}</p>;
}

/** "Stuck? The lessons A and B explain the keys for this." */
function Stuck({ lessons }: { lessons: LessonLink[] }) {
  const i = useI18n();
  if (!lessons.length) return null;
  return <p className="text-sm">{i.rich(i.m.task.stuck, { n: lessons.length, lessons: linkList(i, lessons) })}</p>;
}

function TextDiff({ want, got }: { want: string[]; got: string[] }) {
  const { m } = useI18n();
  const block = (title: string, lines: string[]) => (
    <figure className="min-w-0 flex-1">
      <figcaption className="text-sm text-muted">{title}</figcaption>
      <pre className="overflow-x-auto rounded border border-line bg-panel p-2 font-mono text-sm">{lines.join('\n')}</pre>
    </figure>
  );
  return (
    <div className="flex flex-wrap gap-3">
      {block(m.task.goal, want)}
      {block(m.task.now, got)}
    </div>
  );
}
