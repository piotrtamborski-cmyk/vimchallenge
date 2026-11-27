/**
 * The daily challenge and the four leaderboards (plany/03).
 *
 * Every UTC day has one official set: five tasks, one per level, the same texts for everyone. An
 * account with a verified email address has one scored go (a run) at it. The tasks come one at a
 * time: each is given when the player asks for it, its clock starts then, and it ends when solved,
 * skipped or out of time. A run belongs to the day it started on and must end within the time of
 * all its tasks from its start, so a day is over for everyone that long after midnight; then it is
 * settled and its entries are final.
 *
 * A run's entry (points, solves, time, league points) is rebuilt from its attempts and from the
 * tasks of the day that count. The weekly, monthly and all-time tables are sums of league points
 * over entries, read straight from them, so voiding a faulty task and rebuilding its day corrects
 * every table at once, and rebuilding again changes nothing.
 *
 * Like rooms, every time-based step follows from stored times and is applied when something reads
 * or changes the state, so a restart loses nothing and no timer is needed.
 */
import { randomInt } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '@vimchallenge/accounts';
import { isToken } from '@vimchallenge/engine';
import {
  GRACE_MS,
  JudgeUnavailable,
  MAX_KEYS,
  type AttemptStatus,
  type CheckResult,
  type Judge,
  type JudgeVerdict,
  type KeysResult,
  type RoomsOptions,
  type TaskView,
} from '@vimchallenge/rooms';
import { availableMs, score, SCORING_VERSION } from '@vimchallenge/rooms/scoring';
import { LEVEL_BASE, onText, tasks as publishedTasks, textCount, type BankTask } from '@vimchallenge/tasks';
import { addDays, dayOf, dayStart, periodDays, type Period } from './periods.ts';

/** Bumped whenever the league points of a day are worked out differently; stored with each day. */
export const LEAGUE_VERSION = 1;
/** League points of a day: the share of the most the day's tasks could give, out of 1000. */
export const leaguePoints = (points: number, max: number): number => (max > 0 ? Math.floor((1000 * points) / max) : 0);
/** The most a task can give: its base and the full bonus. */
export const maxPoints = (base: number, referenceMs: number): number => base + score(base, referenceMs, 0).bonus;

/** The keys of a day's runs are deleted this long after the day is settled (kept for disputes). */
export const KEYS_KEPT_MS = 7 * 86_400_000;
export const PAGE_SIZE = 50;

export interface DailyOptions {
  judge: Judge;
  now?: () => number;
  /** A whole number from 0 to n - 1 (tests pass their own). */
  random?: (n: number) => number;
  tasks?: readonly BankTask[];
  /** A solve, for the player's progress. */
  onSolved?: RoomsOptions['onSolved'];
}

/** A task of a set as anyone may see it before playing: no task, no text. */
export interface SetTaskView {
  position: number;
  level: number;
  base: number;
  maxPoints: number;
  availableMs: number;
  voided: boolean;
}

export interface SetView {
  day: string;
  tasks: SetTaskView[];
  /** The most the tasks that count can give. */
  maxPoints: number;
  /** The time of all tasks: how long a run may last. */
  totalMs: number;
}

/** One task of a run as its player sees it. */
export interface RunTaskView extends SetTaskView {
  status: AttemptStatus | 'not-reached';
  /** Which task it was, once it has been given. */
  taskId?: string;
  title?: string;
  text?: number;
  /**
   * A text to practise the task on: another one while the day is open (the official text is
   * shown once the day is settled), or none when the task has only one.
   */
  practise?: number;
  /** Time of the solve. */
  ms?: number;
  /** Points scored (base and bonus; 0 unless solved), and the bonus part of them. */
  earned: number;
  bonus: number;
}

/** The task being played. */
export interface CurrentTask {
  position: number;
  level: number;
  base: number;
  referenceMs: number;
  startsAt: number;
  deadline: number;
  task: TaskView;
  mine: { status: AttemptStatus; keys: string[]; checks: number; ms?: number; base: number; bonus: number };
}

export interface RunView {
  day: string;
  startedAt: number;
  /** The latest the run can go on. */
  endsAt: number;
  finished: boolean;
  tasks: RunTaskView[];
  current?: CurrentTask;
  /** The position to ask for next, when the task before is over and there is time left. */
  next?: number;
  points: number;
  solves: number;
  seconds: number;
  maxPoints: number;
  league: number;
}

export interface DailyView {
  /** Server time of this view, for the page's clock. */
  now: number;
  today: string;
  /** 00:00 UTC of tomorrow: the last moment to start today's set. */
  nextDayAt: number;
  set: SetView;
  you?: {
    eligible: boolean;
    /** Whether the name goes on the public tables; null until the player chooses. */
    onBoards: boolean | null;
    /** The run in progress (it may have started yesterday), or else today's. */
    run?: RunView;
    /** Yesterday's run, when today's is not under way: its result. */
    yesterday?: { day: string; points: number; league: number; maxPoints: number };
  };
}

export type StartResult = { ok: true } | { ok: false; error: 'not-eligible' | 'played' | 'busy' | 'no-tasks' };
export type NextResult = 'ok' | 'no-run' | 'busy' | 'done';
export type SkipResult = AttemptStatus | 'not-playing';

export interface BoardRow {
  rank: number;
  name: string;
  /** Points of the day on the daily table; league points on the others. */
  points: number;
  you: boolean;
  /** Daily table: solves, whole seconds on them, league points. */
  solves?: number;
  seconds?: number;
  league?: number;
  /** Other tables: days played. */
  days?: number;
}

export interface Board {
  period: Period;
  key: string;
  first: string;
  last: string;
  /** Every day of the period is over and settled: the places will not change (but by a correction). */
  final: boolean;
  rows: BoardRow[];
  total: number;
  page: number;
  pages: number;
  /** The viewer's place; `listed` is false when they keep their name off the public tables. */
  you?: BoardRow & { listed: boolean };
  /** The day's tasks, once the day is settled (daily table only). */
  set?: { position: number; level: number; taskId: string; title: string; text: number; voided: boolean }[];
}

export interface Correction {
  day: string;
  position: number;
  action: 'void' | 'restore';
  reason: string;
  at: number;
  before: { user: string; points: number; league: number }[];
}

interface SetRow {
  day: string;
  settledAt: number | null;
  cancelledAt: number | null;
}

interface TaskRow {
  position: number;
  taskId: string;
  taskVersion: number;
  text: number;
  level: number;
  base: number;
  referenceMs: number;
  availableMs: number;
  voidedAt: number | null;
}

interface RunRow {
  day: string;
  userId: string;
  startedAt: number;
  endsAt: number;
  finishedAt: number | null;
}

interface AttemptRow {
  position: number;
  startsAt: number;
  deadline: number;
  keys: string;
  keyCount: number;
  status: AttemptStatus;
  submittedCount: number | null;
  submittedAt: number | null;
  checks: number;
  resolvedAt: number | null;
  ms: number | null;
  base: number;
  bonus: number;
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export class Daily {
  readonly db: DatabaseSync;
  private readonly judge: Judge;
  private readonly now: () => number;
  private readonly random: (n: number) => number;
  private readonly tasks: readonly BankTask[];
  private readonly onSolved: DailyOptions['onSolved'];
  private depth = 0;
  private purgedAt = 0;

  constructor(db: DatabaseSync, options: DailyOptions) {
    this.db = db;
    this.judge = options.judge;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? ((n) => randomInt(n));
    this.tasks = options.tasks ?? publishedTasks;
    this.onSolved = options.onSolved;
  }

  // Playing

  /** Accounts with a verified email address (from any sign-in method) may play. */
  eligible(userId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM identities WHERE user_id = ? AND email IS NOT NULL LIMIT 1').get(userId);
  }

  /** Today's set, and the player's run, after applying what is due. */
  view(userId?: string): DailyView {
    this.settle();
    const now = this.now();
    const today = dayOf(now);
    this.ensureSet(today);
    const view: DailyView = { now, today, nextDayAt: dayStart(addDays(today, 1)), set: this.setView(today) };
    if (!userId) return view;

    const run = this.activeRun(userId) ?? this.run(today, userId);
    const before = !run || run.day === today ? this.run(addDays(today, -1), userId) : undefined;
    const entry = before?.finishedAt ? this.entry(before.day, userId) : undefined;
    const onBoards = this.db.prepare('SELECT on_boards FROM users WHERE id = ?').get(userId)?.on_boards;
    view.you = {
      eligible: this.eligible(userId),
      onBoards: onBoards === null || onBoards === undefined ? null : Number(onBoards) === 1,
      run: run && this.runView(run),
      yesterday: entry && { day: before!.day, points: entry.points, league: entry.league, maxPoints: entry.maxPoints },
    };
    return view;
  }

  /**
   * Starts the player's run at today's set and gives the first task. `onBoards` is their choice to
   * show their name on the public tables (kept for later days too).
   */
  start(userId: string, onBoards: boolean): StartResult {
    this.settle();
    if (!this.eligible(userId)) return { ok: false, error: 'not-eligible' };
    const now = this.now();
    const today = dayOf(now);
    this.ensureSet(today);
    return this.tx(() => {
      const active = this.activeRun(userId);
      if (active) return active.day === today ? { ok: true } : { ok: false, error: 'busy' };
      if (this.run(today, userId)) return { ok: false, error: 'played' };
      const counted = this.setTasks(today).filter((t) => t.voidedAt === null);
      if (!counted.length) return { ok: false, error: 'no-tasks' };
      const endsAt = now + counted.reduce((sum, t) => sum + t.availableMs, 0);
      this.db.prepare('INSERT INTO daily_runs (day, user_id, started_at, ends_at) VALUES (?, ?, ?, ?)').run(today, userId, now, endsAt);
      this.db.prepare('UPDATE users SET on_boards = ? WHERE id = ?').run(onBoards ? 1 : 0, userId);
      const run = this.run(today, userId)!;
      this.issue(run, counted[0]!);
      this.rebuildEntry(today, userId);
      return { ok: true };
    });
  }

  /** Gives the next task of the run, once the one before is over. */
  next(userId: string, day: string): NextResult {
    const run = this.settledRun(day, userId);
    if (!run) return 'no-run';
    return this.tx(() => {
      if (run.finishedAt !== null) return 'done';
      const attempts = this.attempts(day, userId);
      if (attempts.some((a) => a.status === 'open')) return 'busy';
      const position = this.nextPosition(run, attempts);
      if (!position) return 'done';
      this.issue(run, position);
      return 'ok';
    });
  }

  /** Adds keys to the task being played (as in a room: `from` is the count the client believes the server has). */
  appendKeys(userId: string, day: string, position: number, from: number, keys: unknown): KeysResult {
    const run = this.settledRun(day, userId);
    const attempt = run && this.attempt(day, userId, position);
    if (!attempt) return { ok: false, error: 'not-playing' };
    if (attempt.status !== 'open' || this.now() > attempt.deadline) return { ok: false, error: 'closed' };
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string' && isToken(k))) return { ok: false, error: 'bad-keys' };
    if (from !== attempt.keyCount) return { ok: true, have: attempt.keyCount };
    if (attempt.keyCount + keys.length > MAX_KEYS) return { ok: false, error: 'too-many-keys', have: attempt.keyCount };
    if (!keys.length) return { ok: true, have: attempt.keyCount };
    const all = [...(JSON.parse(attempt.keys) as string[]), ...(keys as string[])];
    this.db
      .prepare("UPDATE daily_attempts SET keys = ?, key_count = ? WHERE day = ? AND user_id = ? AND position = ? AND key_count = ? AND status = 'open'")
      .run(JSON.stringify(all), all.length, day, userId, position, attempt.keyCount);
    return { ok: true, have: all.length };
  }

  /**
   * Checks the first `count` keys of the task being played. As in a room, the time of a solve is
   * when the server received the check with all its keys, kept while the judge is unavailable; a
   * solve closes the task and is scored once, and asking again (another tab) returns the same.
   */
  async check(userId: string, day: string, position: number, count: number): Promise<CheckResult> {
    const run = this.settledRun(day, userId);
    const attempt = run && this.attempt(day, userId, position);
    if (!run || !attempt) return { result: 'error', error: 'not-playing' };
    if (attempt.status === 'solved') return { result: 'solved', ms: attempt.ms!, base: attempt.base, bonus: attempt.bonus };
    if (attempt.status !== 'open') return { result: 'closed', status: attempt.status };
    if (count !== attempt.keyCount) return { result: 'error', error: 'missing-keys', have: attempt.keyCount };
    const now = this.now();
    const receivedAt = attempt.submittedCount === count && attempt.submittedAt !== null ? attempt.submittedAt : now;
    if (receivedAt > attempt.deadline) return { result: 'error', error: 'late' };
    const where = 'WHERE day = ? AND user_id = ? AND position = ?';
    this.db.prepare(`UPDATE daily_attempts SET submitted_count = ?, submitted_at = ?, checks = checks + 1 ${where}`).run(count, receivedAt, day, userId, position);

    const task = this.setTasks(day).find((t) => t.position === position)!;
    let verdict: JudgeVerdict;
    try {
      verdict = await this.judge({ task: task.taskId, version: task.taskVersion, text: task.text, keys: JSON.parse(attempt.keys) as string[] });
    } catch (err) {
      if (err instanceof JudgeUnavailable) return { result: 'error', error: 'judge-unavailable' };
      throw err;
    }
    if (verdict.verdict !== 'passed') {
      this.db
        .prepare(`UPDATE daily_attempts SET submitted_count = NULL, submitted_at = NULL ${where} AND submitted_count = ?`)
        .run(day, userId, position, count);
      return verdict.verdict === 'failed' ? { result: 'failed', failures: verdict.failures } : { result: 'rejected', reason: verdict.reason };
    }

    const ms = receivedAt - attempt.startsAt;
    const points = score(task.base, task.referenceMs, ms);
    const solved = this.tx(() => {
      const changes = this.db
        .prepare(
          `UPDATE daily_attempts SET status = 'solved', resolved_at = ?, ms = ?, base = ?, bonus = ?, submitted_count = NULL, submitted_at = NULL ${where} AND status = 'open'`,
        )
        .run(this.now(), ms, points.base, points.bonus, day, userId, position).changes;
      this.rebuildEntry(day, userId);
      return changes > 0;
    });
    if (solved) this.onSolved?.(userId, { taskId: task.taskId, text: task.text, taskVersion: task.taskVersion, judgeVersion: verdict.judgeVersion ?? 0, keys: count });
    this.settledRun(day, userId);
    const after = this.attempt(day, userId, position)!;
    if (after.status === 'solved') return { result: 'solved', ms: after.ms!, base: after.base, bonus: after.bonus };
    return { result: 'closed', status: after.status };
  }

  /** Gives up the task being played: no points for it. */
  skip(userId: string, day: string, position: number): SkipResult {
    const run = this.settledRun(day, userId);
    if (!run || !this.attempt(day, userId, position)) return 'not-playing';
    this.tx(() => {
      this.db
        .prepare("UPDATE daily_attempts SET status = 'skipped', resolved_at = ? WHERE day = ? AND user_id = ? AND position = ? AND status = 'open'")
        .run(this.now(), day, userId, position);
      this.rebuildEntry(day, userId);
    });
    this.settledRun(day, userId);
    return this.attempt(day, userId, position)!.status;
  }

  // Leaderboards

  /**
   * A table: a day ranked by its points (then more solves, then less time, as in a room), or a
   * week, month or all time ranked by the sum of league points. Equal results share a place. Only
   * players who chose to be shown are listed; the viewer sees their own place in any case.
   */
  board(period: Period, key: string, viewer?: string, page = 0): Board | undefined {
    const days = periodDays(period, key);
    if (!days) return undefined;
    this.settle();
    const today = dayOf(this.now());
    const unsettled = Number(
      this.db.prepare('SELECT count(*) AS n FROM daily_sets WHERE day BETWEEN ? AND ? AND settled_at IS NULL').get(days.first, days.last)!.n,
    );
    const final = unsettled === 0 && days.last < today && period !== 'all';

    const daily = period === 'day';
    const ranked = daily
      ? `SELECT e.user_id, u.name, u.on_boards, e.points, e.solves, e.seconds, e.league
           FROM daily_entries e JOIN users u ON u.id = e.user_id JOIN daily_sets s ON s.day = e.day
          WHERE e.day = ?1 AND ?1 = ?2 AND s.cancelled_at IS NULL`
      : `SELECT e.user_id, u.name, u.on_boards, sum(e.league) AS points, count(*) AS days
           FROM daily_entries e JOIN users u ON u.id = e.user_id JOIN daily_sets s ON s.day = e.day
          WHERE e.day BETWEEN ?1 AND ?2 AND s.cancelled_at IS NULL
          GROUP BY e.user_id`;
    const order = daily ? 'points DESC, solves DESC, seconds ASC' : 'points DESC';
    const listed = `WITH all_rows AS (${ranked}), listed AS (
        SELECT *, RANK() OVER (ORDER BY ${order}) AS rank FROM all_rows WHERE on_boards = 1)`;

    const total = Number(this.db.prepare(`${listed} SELECT count(*) AS n FROM listed`).get(days.first, days.last)!.n);
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const at = Math.min(Math.max(0, Math.floor(page) || 0), pages - 1);
    const toRow = (r: Row): BoardRow => ({
      rank: Number(r.rank),
      name: String(r.name),
      points: Number(r.points),
      you: r.user_id === viewer,
      ...(daily ? { solves: Number(r.solves), seconds: Number(r.seconds), league: Number(r.league) } : { days: Number(r.days) }),
    });
    const rows = this.db
      .prepare(`${listed} SELECT * FROM listed ORDER BY rank, name LIMIT ${PAGE_SIZE} OFFSET ${at * PAGE_SIZE}`)
      .all(days.first, days.last)
      .map(toRow);

    let you: Board['you'];
    if (viewer) {
      const mine = this.db.prepare(`WITH all_rows AS (${ranked}) SELECT * FROM all_rows WHERE user_id = ?3`).get(days.first, days.last, viewer);
      if (mine) {
        const shown = Number(mine.on_boards) === 1;
        const better = daily
          ? 'points > ?3 OR (points = ?3 AND (solves > ?4 OR (solves = ?4 AND seconds < ?5)))'
          : 'points > ?3';
        const ahead = Number(
          this.db
            .prepare(`WITH all_rows AS (${ranked}) SELECT count(*) AS n FROM all_rows WHERE on_boards = 1 AND user_id != ?6 AND (${better})`)
            .get(days.first, days.last, Number(mine.points), Number(mine.solves ?? 0), Number(mine.seconds ?? 0), viewer)!.n,
        );
        you = { ...toRow({ ...mine, rank: ahead + 1 }), listed: shown };
      }
    }

    const board: Board = { period, key, first: days.first, last: days.last, final, rows, total, page: at, pages, you };
    if (daily) {
      const set = this.setRow(key);
      if (set?.settledAt !== null && set?.settledAt !== undefined)
        board.set = this.setTasks(key).map((t) => ({
          position: t.position,
          level: t.level,
          taskId: t.taskId,
          title: this.task(t.taskId)?.title ?? t.taskId,
          text: t.text,
          voided: t.voidedAt !== null,
        }));
    }
    return board;
  }

  // Corrections

  /**
   * Takes a faulty task out of a day (or puts it back) for every run, and rebuilds the day's
   * entries, so every table follows. A day without any task that counts is cancelled. The entries
   * as they were before are kept with the correction.
   */
  correct(day: string, position: number, action: 'void' | 'restore', reason: string): 'ok' | 'not-found' | 'unchanged' {
    return this.tx(() => {
      const task = this.setTasks(day).find((t) => t.position === position);
      if (!task) return 'not-found';
      if ((task.voidedAt !== null) === (action === 'void')) return 'unchanged';
      const before = this.db
        .prepare('SELECT user_id AS user, points, league FROM daily_entries WHERE day = ? ORDER BY user_id')
        .all(day)
        .map((r) => ({ user: String(r.user), points: Number(r.points), league: Number(r.league) }));
      const now = this.now();
      this.db.prepare('UPDATE daily_tasks SET voided_at = ? WHERE day = ? AND position = ?').run(action === 'void' ? now : null, day, position);
      this.db
        .prepare('INSERT INTO daily_corrections (day, position, action, reason, at, before) VALUES (?, ?, ?, ?, ?, ?)')
        .run(day, position, action, reason, now, JSON.stringify(before));
      this.rebuildDay(day);
      return 'ok';
    });
  }

  corrections(day: string): Correction[] {
    return this.db
      .prepare('SELECT day, position, action, reason, at, before FROM daily_corrections WHERE day = ? ORDER BY id')
      .all(day)
      .map((r) => ({
        day: String(r.day),
        position: Number(r.position),
        action: r.action as Correction['action'],
        reason: String(r.reason),
        at: Number(r.at),
        before: JSON.parse(String(r.before)) as Correction['before'],
      }));
  }

  /** Rebuilds every entry of a day from its attempts (after a restore from a backup, say). */
  rebuild(day: string): void {
    this.tx(() => this.rebuildDay(day));
  }

  /**
   * Applies what is due: a day whose last possible run is over is settled (its open runs end and
   * its entries are rebuilt and final), and the keys of days settled a week ago are deleted.
   */
  settle(): void {
    const now = this.now();
    const open = this.db.prepare('SELECT day FROM daily_sets WHERE settled_at IS NULL').all() as { day: string }[];
    for (const { day } of open) {
      if (now < this.closesAt(day)) continue;
      this.tx(() => {
        for (const run of this.runs(day)) if (run.finishedAt === null) this.settleRun(run);
        this.rebuildDay(day);
        this.db.prepare('UPDATE daily_sets SET settled_at = ? WHERE day = ?').run(now, day);
      });
    }
    if (now - this.purgedAt >= 3_600_000) {
      this.purgedAt = now;
      this.db
        .prepare("UPDATE daily_attempts SET keys = '[]' WHERE keys != '[]' AND day IN (SELECT day FROM daily_sets WHERE settled_at <= ?)")
        .run(now - KEYS_KEPT_MS);
    }
  }

  /** When a day is settled: midnight after it, plus the time of its tasks, plus the judge's grace. */
  closesAt(day: string): number {
    const total = this.setTasks(day).reduce((sum, t) => sum + t.availableMs, 0);
    return dayStart(addDays(day, 1)) + total + GRACE_MS;
  }

  // Internals

  private tx<T>(fn: () => T): T {
    if (this.depth) return fn();
    this.depth++;
    try {
      return transaction(this.db, fn);
    } finally {
      this.depth--;
    }
  }

  /** Makes a day's set if it has none: for each level, a task the set has used least recently. */
  private ensureSet(day: string) {
    if (this.setRow(day)) return;
    this.tx(() => {
      if (this.setRow(day)) return;
      this.db
        .prepare('INSERT INTO daily_sets (day, scoring, league, created_at) VALUES (?, ?, ?, ?)')
        .run(day, SCORING_VERSION, LEAGUE_VERSION, this.now());
      const levels = [...new Set(this.tasks.map((t) => t.level))].filter((l) => LEVEL_BASE[l] !== undefined).sort((a, b) => a - b);
      const add = this.db.prepare(
        'INSERT INTO daily_tasks (day, position, task_id, task_version, text, level, base, reference_ms, available_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const [i, level] of levels.entries()) {
        const used = new Map(
          (this.db.prepare('SELECT task_id, max(day) AS last FROM daily_tasks WHERE level = ? AND day < ? GROUP BY task_id').all(level, day) as Row[]).map(
            (r) => [String(r.task_id), String(r.last)],
          ),
        );
        const pool = this.tasks.filter((t) => t.level === level);
        const oldest = pool.reduce((min, t) => ((used.get(t.id) ?? '') < min ? (used.get(t.id) ?? '') : min), '￿');
        const fresh = pool.filter((t) => (used.get(t.id) ?? '') === oldest);
        const task = fresh[this.random(fresh.length)]!;
        const texts = this.db.prepare('SELECT text, count(*) AS n FROM daily_tasks WHERE task_id = ? GROUP BY text').all(task.id) as Row[];
        const timesUsed = (n: number) => Number(texts.find((r) => Number(r.text) === n)?.n ?? 0);
        const all = Array.from({ length: textCount(task) }, (_, k) => k + 1);
        const least = Math.min(...all.map(timesUsed));
        const candidates = all.filter((n) => timesUsed(n) === least);
        const text = candidates[this.random(candidates.length)]!;
        const referenceMs = (task.referenceSeconds ?? 30) * 1000;
        add.run(day, i + 1, task.id, task.version, text, level, LEVEL_BASE[level]!, referenceMs, availableMs(referenceMs));
      }
    });
  }

  private setView(day: string): SetView {
    const tasks = this.setTasks(day).map((t) => ({
      position: t.position,
      level: t.level,
      base: t.base,
      maxPoints: maxPoints(t.base, t.referenceMs),
      availableMs: t.availableMs,
      voided: t.voidedAt !== null,
    }));
    return {
      day,
      tasks,
      maxPoints: tasks.filter((t) => !t.voided).reduce((sum, t) => sum + t.maxPoints, 0),
      totalMs: tasks.filter((t) => !t.voided).reduce((sum, t) => sum + t.availableMs, 0),
    };
  }

  private runView(run: RunRow): RunView {
    const now = this.now();
    const set = this.setTasks(run.day);
    const attempts = this.attempts(run.day, run.userId);
    const entry = this.entry(run.day, run.userId);
    const settled = this.setRow(run.day)?.settledAt !== null;
    const tasks: RunTaskView[] = set.map((t) => {
      const a = attempts.find((x) => x.position === t.position);
      const bank = this.task(t.taskId);
      const count = bank ? textCount(bank) : 1;
      const practise = settled ? t.text : count > 1 ? (t.text % count) + 1 : undefined;
      return {
        position: t.position,
        level: t.level,
        base: t.base,
        earned: (a?.base ?? 0) + (a?.bonus ?? 0),
        bonus: a?.bonus ?? 0,
        maxPoints: maxPoints(t.base, t.referenceMs),
        availableMs: t.availableMs,
        voided: t.voidedAt !== null,
        status: a?.status ?? 'not-reached',
        ...(a && { taskId: t.taskId, title: bank?.title ?? t.taskId, text: t.text, practise, ms: a.ms ?? undefined }),
      };
    });
    const open = attempts.find((a) => a.status === 'open');
    const openTask = open && set.find((t) => t.position === open.position);
    const text = openTask && this.task(openTask.taskId) && onText(this.task(openTask.taskId)!, openTask.text);
    const current: CurrentTask | undefined =
      open && openTask && text
        ? {
            position: open.position,
            level: openTask.level,
            base: openTask.base,
            referenceMs: openTask.referenceMs,
            startsAt: open.startsAt,
            deadline: open.deadline,
            task: {
              id: text.id,
              version: text.version,
              text: openTask.text,
              title: text.title,
              prompt: text.prompt,
              initial: text.initial,
              expected: text.expected,
            },
            mine: {
              status: open.status,
              keys: JSON.parse(open.keys) as string[],
              checks: open.checks,
              ms: open.ms ?? undefined,
              base: open.base,
              bonus: open.bonus,
            },
          }
        : undefined;
    const next = run.finishedAt === null && !open && now < run.endsAt ? this.nextPosition(run, attempts)?.position : undefined;
    return {
      day: run.day,
      startedAt: run.startedAt,
      endsAt: run.endsAt,
      finished: run.finishedAt !== null,
      tasks,
      current,
      next,
      points: entry?.points ?? 0,
      solves: entry?.solves ?? 0,
      seconds: entry?.seconds ?? 0,
      maxPoints: entry?.maxPoints ?? 0,
      league: entry?.league ?? 0,
    };
  }

  /** The next task of a run that counts and has not been given yet, if the run has time for it. */
  private nextPosition(run: RunRow, attempts: AttemptRow[]): TaskRow | undefined {
    if (this.now() >= run.endsAt) return undefined;
    return this.setTasks(run.day).find((t) => t.voidedAt === null && !attempts.some((a) => a.position === t.position));
  }

  /** Gives a task: its clock starts now, and it ends with its time or with the run, whichever is first. */
  private issue(run: RunRow, task: TaskRow) {
    const now = this.now();
    this.db
      .prepare('INSERT INTO daily_attempts (day, user_id, position, starts_at, deadline) VALUES (?, ?, ?, ?, ?)')
      .run(run.day, run.userId, task.position, now, Math.min(now + task.availableMs, run.endsAt));
  }

  /** A run after applying what is due to it. */
  private settledRun(day: string, userId: string): RunRow | undefined {
    const run = this.run(day, userId);
    if (run && run.finishedAt === null) this.tx(() => this.settleRun(run));
    return this.run(day, userId);
  }

  /**
   * A task past its deadline times out (unless a check received in time waits for the judge, for a
   * short grace); a run with nothing left to give, or no time left, is finished.
   */
  private settleRun(run: RunRow) {
    const now = this.now();
    const open = this.attempts(run.day, run.userId).find((a) => a.status === 'open');
    if (open && now > open.deadline) {
      const pending = open.submittedAt !== null && open.submittedAt <= open.deadline;
      if (!pending || now > open.deadline + GRACE_MS) {
        this.db
          .prepare("UPDATE daily_attempts SET status = 'timeout', resolved_at = ? WHERE day = ? AND user_id = ? AND position = ? AND status = 'open'")
          .run(pending ? open.deadline + GRACE_MS : open.deadline, run.day, run.userId, open.position);
        this.rebuildEntry(run.day, run.userId);
      }
    }
    const attempts = this.attempts(run.day, run.userId);
    if (attempts.some((a) => a.status === 'open')) return;
    const left = this.setTasks(run.day).some((t) => t.voidedAt === null && !attempts.some((a) => a.position === t.position));
    if (left && now < run.endsAt) return;
    const last = Math.max(run.startedAt, ...attempts.map((a) => a.resolvedAt ?? a.startsAt));
    this.db
      .prepare('UPDATE daily_runs SET finished_at = ? WHERE day = ? AND user_id = ? AND finished_at IS NULL')
      .run(left ? Math.max(last, run.endsAt) : last, run.day, run.userId);
  }

  private rebuildDay(day: string) {
    for (const run of this.runs(day)) this.rebuildEntry(day, run.userId);
    const counted = this.setTasks(day).some((t) => t.voidedAt === null);
    this.db
      .prepare('UPDATE daily_sets SET cancelled_at = ? WHERE day = ?')
      .run(counted ? null : (this.setRow(day)?.cancelledAt ?? this.now()), day);
  }

  /** A run's entry from its solves of the tasks that count. */
  private rebuildEntry(day: string, userId: string) {
    const counted = this.setTasks(day).filter((t) => t.voidedAt === null);
    const max = counted.reduce((sum, t) => sum + maxPoints(t.base, t.referenceMs), 0);
    const solves = this.attempts(day, userId).filter((a) => a.status === 'solved' && counted.some((t) => t.position === a.position));
    const points = solves.reduce((sum, a) => sum + a.base + a.bonus, 0);
    const seconds = solves.reduce((sum, a) => sum + Math.floor(a.ms! / 1000), 0);
    this.db
      .prepare(
        `INSERT INTO daily_entries (day, user_id, points, solves, seconds, max_points, league) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (day, user_id) DO UPDATE SET points = excluded.points, solves = excluded.solves, seconds = excluded.seconds,
           max_points = excluded.max_points, league = excluded.league`,
      )
      .run(day, userId, points, solves.length, seconds, max, leaguePoints(points, max));
  }

  private entry(day: string, userId: string) {
    const r = this.db.prepare('SELECT points, solves, seconds, max_points, league FROM daily_entries WHERE day = ? AND user_id = ?').get(day, userId);
    return (
      r && { points: Number(r.points), solves: Number(r.solves), seconds: Number(r.seconds), maxPoints: Number(r.max_points), league: Number(r.league) }
    );
  }

  private task(id: string): BankTask | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  private setRow(day: string): SetRow | undefined {
    const r = this.db.prepare('SELECT day, settled_at, cancelled_at FROM daily_sets WHERE day = ?').get(day);
    return r && { day: String(r.day), settledAt: num(r.settled_at), cancelledAt: num(r.cancelled_at) };
  }

  private setTasks(day: string): TaskRow[] {
    return this.db
      .prepare('SELECT * FROM daily_tasks WHERE day = ? ORDER BY position')
      .all(day)
      .map((r: Row) => ({
        position: Number(r.position),
        taskId: String(r.task_id),
        taskVersion: Number(r.task_version),
        text: Number(r.text),
        level: Number(r.level),
        base: Number(r.base),
        referenceMs: Number(r.reference_ms),
        availableMs: Number(r.available_ms),
        voidedAt: num(r.voided_at),
      }));
  }

  private run(day: string, userId: string): RunRow | undefined {
    const r = this.db.prepare('SELECT * FROM daily_runs WHERE day = ? AND user_id = ?').get(day, userId);
    return r && toRun(r);
  }

  /** The player's run that has not finished, after applying what is due (at most one). */
  private activeRun(userId: string): RunRow | undefined {
    const rows = this.db.prepare('SELECT * FROM daily_runs WHERE user_id = ? AND finished_at IS NULL ORDER BY day').all(userId).map(toRun);
    for (const run of rows) this.tx(() => this.settleRun(run));
    return rows.map((r) => this.run(r.day, r.userId)!).find((r) => r.finishedAt === null);
  }

  private runs(day: string): RunRow[] {
    return this.db.prepare('SELECT * FROM daily_runs WHERE day = ?').all(day).map(toRun);
  }

  private attempts(day: string, userId: string): AttemptRow[] {
    return this.db.prepare('SELECT * FROM daily_attempts WHERE day = ? AND user_id = ? ORDER BY position').all(day, userId).map(toAttempt);
  }

  private attempt(day: string, userId: string, position: number): AttemptRow | undefined {
    const r = this.db.prepare('SELECT * FROM daily_attempts WHERE day = ? AND user_id = ? AND position = ?').get(day, userId, position);
    return r && toAttempt(r);
  }
}

const toRun = (r: Row): RunRow => ({
  day: String(r.day),
  userId: String(r.user_id),
  startedAt: Number(r.started_at),
  endsAt: Number(r.ends_at),
  finishedAt: num(r.finished_at),
});

const toAttempt = (r: Row): AttemptRow => ({
  position: Number(r.position),
  startsAt: Number(r.starts_at),
  deadline: Number(r.deadline),
  keys: String(r.keys),
  keyCount: Number(r.key_count),
  status: r.status as AttemptStatus,
  submittedCount: num(r.submitted_count),
  submittedAt: num(r.submitted_at),
  checks: Number(r.checks),
  resolvedAt: num(r.resolved_at),
  ms: num(r.ms),
  base: Number(r.base),
  bonus: Number(r.bonus),
});
