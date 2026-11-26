/**
 * Live rooms (plany/03): players gather in a room by its invite code, mark themselves ready, and
 * the host starts a match of a few rounds. In each round everyone gets the same task on the same
 * text at the same moment, edits on their own, and checks; the server replays their keys with the
 * judge and scores the solve by the time it received the check.
 *
 * All state is in the database and every time-based step (a round starting, its deadline) follows
 * from stored times, so a reload, a second tab or a restart of the process finds the same match.
 * `settle` applies the steps that are due; callers run it before reading or changing a match.
 */
import { randomBytes, randomInt } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { transaction, validName } from '@vimchallenge/accounts';
import { isToken, type Expected, type GoalFailure, type InitialState } from '@vimchallenge/engine';
import { LEVEL_BASE, onText, tasks as publishedTasks, textCount, type BankTask } from '@vimchallenge/tasks';
import { availableMs, score, SCORING_VERSION, standings, type Standing, type Tally } from './scoring.ts';

export type LevelChoice = 'mixed' | '1' | '2' | '3' | '4' | '5';

export interface RoomSettings {
  rounds: number;
  level: LevelChoice;
}

/** Who is acting: 'u:' and an account id for a signed-in player, 'g:' and a guest id otherwise. */
export interface Player {
  id: string;
  userId?: string;
}

export type AttemptStatus = 'open' | 'solved' | 'skipped' | 'timeout';
export type Phase = 'lobby' | 'countdown' | 'round' | 'break' | 'finished';

export type JudgeVerdict =
  | { verdict: 'passed'; judgeVersion?: number }
  | { verdict: 'failed'; failures: GoalFailure[] }
  | { verdict: 'rejected'; reason: string };

export interface JudgeJob {
  task: string;
  version: number;
  text: number;
  keys: string[];
}

/** Judges a run; throws `JudgeUnavailable` when there is no verdict to be had right now. */
export type Judge = (job: JudgeJob) => Promise<JudgeVerdict>;

export class JudgeUnavailable extends Error {}

export interface RoomsOptions {
  judge: Judge;
  now?: () => number;
  /** A whole number from 0 to n - 1 (tests pass their own). */
  random?: (n: number) => number;
  tasks?: readonly BankTask[];
  /** A signed-in player solved a round: for their progress. */
  onSolved?: (userId: string, solve: { taskId: string; text: number; taskVersion: number; judgeVersion: number; keys: number }) => void;
}

export const MAX_MEMBERS = 8;
export const MIN_PLAYERS = 2;
export const MAX_ROUNDS = 5;
export const MAX_KEYS = 5000;
/** From the start of a match to its first round. */
export const COUNTDOWN_MS = 5_000;
/** From the end of a round to the start of the next: its results, then a countdown. */
export const BREAK_MS = 12_000;
/** How long after a deadline a check received in time may wait for the judge. */
export const GRACE_MS = 15_000;
/** A member not seen for this long is shown as away. */
export const AWAY_MS = 45_000;
/** When the host has been away this long, another member may start the match. */
export const HOST_AWAY_MS = 60_000;
/** A room is deleted a week after its last activity. */
export const ROOM_TTL_MS = 7 * 86_400_000;

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_LENGTH = 10;

export interface MemberView {
  name: string;
  ready: boolean;
  host: boolean;
  away: boolean;
  you: boolean;
}

export interface TaskView {
  id: string;
  version: number;
  text: number;
  title: string;
  prompt: string;
  initial: InitialState;
  expected: Expected;
}

export interface RoundView {
  number: number;
  level: number;
  base: number;
  referenceMs: number;
  availableMs: number;
  startsAt: number;
  deadline: number;
  /** Given to the match's players once the round has started. */
  task?: TaskView;
  /** What each player is doing; times and points only after the round. */
  statuses: { name: string; you: boolean; away: boolean; status: AttemptStatus }[];
  mine?: { status: AttemptStatus; keys: string[]; checks: number; ms?: number; base: number; bonus: number };
}

export interface RoundResult {
  number: number;
  taskId: string;
  title: string;
  text: number;
  level: number;
  results: { name: string; you: boolean; status: AttemptStatus; ms?: number; base: number; bonus: number }[];
}

export interface MatchView {
  number: number;
  rounds: number;
  startedAt: number;
  /** Totals over the rounds that have ended. */
  standings: (Standing & { you: boolean })[];
  /** The round under way, or the next one during a countdown or break. */
  round?: RoundView;
  /** Rounds that have ended, first to last. */
  past: RoundResult[];
}

export interface RoomView {
  code: string;
  /** Server time of this view, for the page's clock. */
  now: number;
  phase: Phase;
  settings: RoomSettings;
  members: MemberView[];
  you?: { name: string; host: boolean; ready: boolean; playing: boolean };
  /** Whether you may start the next match now, and if not, why. */
  start: { allowed: boolean; reason?: string };
  match?: MatchView;
}

export type JoinResult = 'ok' | 'not-found' | 'full' | 'name-invalid' | 'name-taken';
export type StartResult = 'ok' | 'not-found' | 'not-member' | 'not-host' | 'too-few' | 'running';

export type KeysResult = { ok: true; have: number } | { ok: false; error: 'not-found' | 'not-playing' | 'closed' | 'not-started' | 'bad-keys' | 'too-many-keys'; have?: number };

export type CheckResult =
  | { result: 'solved'; ms: number; base: number; bonus: number }
  | { result: 'failed'; failures: GoalFailure[] }
  | { result: 'rejected'; reason: string }
  | { result: 'closed'; status: AttemptStatus }
  | { result: 'error'; error: 'not-found' | 'not-playing' | 'not-started' | 'missing-keys' | 'late' | 'judge-unavailable'; have?: number };

interface RoomRow {
  id: string;
  code: string;
  host: string;
  rounds: number;
  level: LevelChoice;
}

interface MemberRow {
  player: string;
  userId: string | null;
  name: string;
  ready: boolean;
  joinedAt: number;
  seenAt: number;
}

interface MatchRow {
  id: string;
  number: number;
  startedAt: number;
  finishedAt: number | null;
}

interface RoundRow {
  number: number;
  taskId: string;
  taskVersion: number;
  text: number;
  level: number;
  referenceMs: number;
  startsAt: number | null;
  deadline: number | null;
  endedAt: number | null;
}

interface AttemptRow {
  player: string;
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

/** A player's attempt at a round of the room's current match, or why there is none. */
type Playing = { error: 'not-found' | 'not-playing' | 'not-started' } | { error?: undefined; matchId: string; r: RoundRow; attempt: AttemptRow };
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export class Rooms {
  readonly db: DatabaseSync;
  private readonly judge: Judge;
  private readonly now: () => number;
  private readonly random: (n: number) => number;
  private readonly tasks: readonly BankTask[];
  private readonly onSolved: RoomsOptions['onSolved'];

  constructor(db: DatabaseSync, options: RoomsOptions) {
    this.db = db;
    this.judge = options.judge;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? ((n) => randomInt(n));
    this.tasks = options.tasks ?? publishedTasks;
    this.onSolved = options.onSolved;
  }

  // Rooms and members

  /** A new room with `host` as its first member; returns its invite code. */
  create(host: Player, name: string, settings: RoomSettings): { ok: true; code: string } | { ok: false; error: 'name-invalid' | 'settings' } {
    if (!validName(name)) return { ok: false, error: 'name-invalid' };
    if (!validSettings(settings)) return { ok: false, error: 'settings' };
    const now = this.now();
    const id = randomBytes(12).toString('base64url');
    const code = this.newCode();
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM rooms WHERE touched_at < ?').run(now - ROOM_TTL_MS);
      this.db
        .prepare('INSERT INTO rooms (id, code, host, rounds, level, created_at, touched_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, code, host.id, settings.rounds, settings.level, now, now);
      this.db
        .prepare('INSERT INTO room_members (room_id, player, user_id, name, joined_at, seen_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, host.id, host.userId ?? null, name, now, now);
    });
    return { ok: true, code };
  }

  /** Joins a room (again: changes the name). Joining during a match waits for the next one. */
  join(code: string, player: Player, name: string): JoinResult {
    const room = this.room(code);
    if (!room) return 'not-found';
    if (!validName(name)) return 'name-invalid';
    const now = this.now();
    return transaction(this.db, () => {
      const member = this.member(room.id, player.id);
      const taken = this.db.prepare('SELECT player FROM room_members WHERE room_id = ? AND name = ?').get(room.id, name);
      if (taken && taken.player !== player.id) return 'name-taken';
      if (member) {
        this.db.prepare('UPDATE room_members SET name = ?, seen_at = ? WHERE room_id = ? AND player = ?').run(name, now, room.id, player.id);
      } else {
        const count = Number(this.db.prepare('SELECT count(*) AS n FROM room_members WHERE room_id = ?').get(room.id)!.n);
        if (count >= MAX_MEMBERS) return 'full';
        this.db
          .prepare('INSERT INTO room_members (room_id, player, user_id, name, joined_at, seen_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(room.id, player.id, player.userId ?? null, name, now, now);
      }
      this.touchRoom(room.id);
      return 'ok';
    });
  }

  /** Leaves the room; a host's place passes to the member who joined first. */
  leave(code: string, player: Player): void {
    const room = this.room(code);
    if (!room) return;
    transaction(this.db, () => {
      this.db.prepare('DELETE FROM room_members WHERE room_id = ? AND player = ?').run(room.id, player.id);
      if (room.host === player.id) {
        const next = this.db.prepare('SELECT player FROM room_members WHERE room_id = ? ORDER BY joined_at LIMIT 1').get(room.id);
        if (next) this.db.prepare('UPDATE rooms SET host = ? WHERE id = ?').run(String(next.player), room.id);
      }
      this.touchRoom(room.id);
    });
  }

  setReady(code: string, player: Player, ready: boolean): boolean {
    const room = this.room(code);
    if (!room) return false;
    const changed = this.db
      .prepare('UPDATE room_members SET ready = ?, seen_at = ? WHERE room_id = ? AND player = ?')
      .run(ready ? 1 : 0, this.now(), room.id, player.id).changes;
    return changed > 0;
  }

  /** The player is still there (their page is connected). */
  touch(code: string, player: Player): void {
    const room = this.room(code);
    if (room) this.db.prepare('UPDATE room_members SET seen_at = ? WHERE room_id = ? AND player = ?').run(this.now(), room.id, player.id);
  }

  /**
   * Starts a match with the members who are ready and present: fixes them as its players, draws a
   * task and text for every round, and starts the first round after a countdown. The host starts;
   * when the host has been away for a minute, the member who joined first among those present may.
   */
  start(code: string, player: Player): StartResult {
    const room = this.room(code);
    if (!room) return 'not-found';
    this.settleRoom(room);
    const now = this.now();
    return transaction(this.db, () => {
      const members = this.members(room.id);
      const permission = this.startPermission(room, members, player.id);
      if (permission !== 'ok') return permission;
      const players = members.filter((m) => m.ready && now - m.seenAt < AWAY_MS);
      if (players.length < MIN_PLAYERS) return 'too-few';

      if (room.host !== player.id) this.db.prepare('UPDATE rooms SET host = ? WHERE id = ?').run(player.id, room.id);
      const number = Number(this.db.prepare('SELECT coalesce(max(number), 0) + 1 AS n FROM matches WHERE room_id = ?').get(room.id)!.n);
      const matchId = randomBytes(12).toString('base64url');
      this.db.prepare('INSERT INTO matches (id, room_id, number, scoring, started_at) VALUES (?, ?, ?, ?, ?)').run(matchId, room.id, number, SCORING_VERSION, now);
      const addPlayer = this.db.prepare('INSERT INTO match_players (match_id, player, user_id, name) VALUES (?, ?, ?, ?)');
      for (const p of players) addPlayer.run(matchId, p.player, p.userId, p.name);

      const addRound = this.db.prepare(
        'INSERT INTO rounds (match_id, number, task_id, task_version, text, level, reference_ms, starts_at, deadline) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const addAttempt = this.db.prepare('INSERT INTO attempts (match_id, round, player) VALUES (?, ?, ?)');
      const picks = this.pickRounds(room);
      for (const [i, pick] of picks.entries()) {
        const referenceMs = (pick.task.referenceSeconds ?? 30) * 1000;
        const startsAt = i === 0 ? now + COUNTDOWN_MS : null;
        const deadline = startsAt === null ? null : startsAt + availableMs(referenceMs);
        addRound.run(matchId, i + 1, pick.task.id, pick.task.version, pick.text, pick.task.level, referenceMs, startsAt, deadline);
        for (const p of players) addAttempt.run(matchId, i + 1, p.player);
      }
      this.db.prepare('UPDATE room_members SET ready = 0 WHERE room_id = ?').run(room.id);
      this.touchRoom(room.id);
      return 'ok';
    });
  }

  // Playing a round

  /**
   * Adds keys to the player's attempt at a round. `from` is how many keys the client believes the
   * server has; a packet that does not continue the stored keys is refused with the right count,
   * so the client can send the missing ones (a lost or repeated packet changes nothing).
   */
  appendKeys(code: string, player: Player, round: number, from: number, keys: unknown): KeysResult {
    const found = this.playing(code, player, round);
    if (found.error) return { ok: false, error: found.error };
    const { matchId, r, attempt } = found;
    const now = this.now();
    if (attempt.status !== 'open' || now > r.deadline!) return { ok: false, error: 'closed' };
    if (now < r.startsAt!) return { ok: false, error: 'not-started' };
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === 'string' && isToken(k))) return { ok: false, error: 'bad-keys' };
    if (from !== attempt.keyCount) return { ok: true, have: attempt.keyCount };
    if (attempt.keyCount + keys.length > MAX_KEYS) return { ok: false, error: 'too-many-keys', have: attempt.keyCount };
    if (!keys.length) return { ok: true, have: attempt.keyCount };
    const all = [...(JSON.parse(attempt.keys) as string[]), ...(keys as string[])];
    this.db
      .prepare("UPDATE attempts SET keys = ?, key_count = ? WHERE match_id = ? AND round = ? AND player = ? AND key_count = ? AND status = 'open'")
      .run(JSON.stringify(all), all.length, matchId, round, player.id, attempt.keyCount);
    return { ok: true, have: all.length };
  }

  /**
   * Checks the player's first `count` keys of a round. The time of a solve is when the server
   * received the check with all its keys; a check repeated while the judge was unavailable keeps
   * that first time. A solve closes the attempt and is scored once; asking again returns the same.
   */
  async check(code: string, player: Player, round: number, count: number): Promise<CheckResult> {
    const found = this.playing(code, player, round);
    if (found.error) return { result: 'error', error: found.error };
    const { matchId, r, attempt } = found;
    if (attempt.status === 'solved') return { result: 'solved', ms: attempt.ms!, base: attempt.base, bonus: attempt.bonus };
    if (attempt.status !== 'open') return { result: 'closed', status: attempt.status };
    const now = this.now();
    if (now < r.startsAt!) return { result: 'error', error: 'not-started' };
    if (count !== attempt.keyCount) return { result: 'error', error: 'missing-keys', have: attempt.keyCount };
    const receivedAt = attempt.submittedCount === count && attempt.submittedAt !== null ? attempt.submittedAt : now;
    if (receivedAt > r.deadline!) return { result: 'error', error: 'late' };
    this.db
      .prepare('UPDATE attempts SET submitted_count = ?, submitted_at = ?, checks = checks + 1 WHERE match_id = ? AND round = ? AND player = ?')
      .run(count, receivedAt, matchId, round, player.id);

    let verdict: JudgeVerdict;
    try {
      verdict = await this.judge({ task: r.taskId, version: r.taskVersion, text: r.text, keys: JSON.parse(attempt.keys) as string[] });
    } catch (err) {
      if (err instanceof JudgeUnavailable) return { result: 'error', error: 'judge-unavailable' };
      throw err;
    }

    const clear = () =>
      this.db
        .prepare('UPDATE attempts SET submitted_count = NULL, submitted_at = NULL WHERE match_id = ? AND round = ? AND player = ? AND submitted_count = ?')
        .run(matchId, round, player.id, count);
    if (verdict.verdict !== 'passed') {
      clear();
      return verdict.verdict === 'failed' ? { result: 'failed', failures: verdict.failures } : { result: 'rejected', reason: verdict.reason };
    }

    const ms = receivedAt - r.startsAt!;
    const points = score(LEVEL_BASE[r.level]!, r.referenceMs, ms);
    const solved = this.db
      .prepare(
        "UPDATE attempts SET status = 'solved', resolved_at = ?, ms = ?, base = ?, bonus = ?, submitted_count = NULL, submitted_at = NULL WHERE match_id = ? AND round = ? AND player = ? AND status = 'open'",
      )
      .run(this.now(), ms, points.base, points.bonus, matchId, round, player.id).changes;
    const after = this.attempt(matchId, round, player.id)!;
    if (solved && player.userId)
      this.onSolved?.(player.userId, { taskId: r.taskId, text: r.text, taskVersion: r.taskVersion, judgeVersion: verdict.judgeVersion ?? 0, keys: count });
    this.settleRoom(this.room(code)!);
    if (after.status === 'solved') return { result: 'solved', ms: after.ms!, base: after.base, bonus: after.bonus };
    return { result: 'closed', status: after.status };
  }

  /** Gives up the round: no points, and the round may end sooner. */
  skip(code: string, player: Player, round: number): AttemptStatus | 'not-found' | 'not-playing' | 'not-started' {
    const found = this.playing(code, player, round);
    if (found.error) return found.error;
    if (this.now() < found.r.startsAt!) return 'not-started';
    this.db
      .prepare("UPDATE attempts SET status = 'skipped', resolved_at = ? WHERE match_id = ? AND round = ? AND player = ? AND status = 'open'")
      .run(this.now(), found.matchId, round, player.id);
    this.settleRoom(this.room(code)!);
    return this.attempt(found.matchId, round, player.id)!.status;
  }

  // Reading

  /** The room as `viewer` sees it, after applying the steps that are due. */
  view(code: string, viewer?: Player): RoomView | undefined {
    const room = this.room(code);
    if (!room) return undefined;
    this.settleRoom(room);
    const now = this.now();
    const members = this.members(room.id);
    const me = viewer && members.find((m) => m.player === viewer.id);
    const match = this.latestMatch(room.id);
    const matchView = match && this.matchView(match, viewer?.id, members, now);
    const running = !!match && match.finishedAt === null;
    const phase: Phase = !match ? 'lobby' : !running ? 'finished' : phaseOf(matchView!.round, now, matchView!.past.length);
    const permission = viewer ? this.startPermission(room, members, viewer.id) : 'not-member';
    const readyCount = members.filter((m) => m.ready && now - m.seenAt < AWAY_MS).length;
    const start =
      permission !== 'ok'
        ? { allowed: false, reason: permission }
        : readyCount < MIN_PLAYERS
          ? { allowed: false, reason: 'too-few' }
          : { allowed: true };
    return {
      code: room.code,
      now,
      phase,
      settings: { rounds: room.rounds, level: room.level },
      members: members.map((m) => ({
        name: m.name,
        ready: m.ready,
        host: m.player === room.host,
        away: now - m.seenAt >= AWAY_MS,
        you: m.player === viewer?.id,
      })),
      you: me && {
        name: me.name,
        host: me.player === room.host,
        ready: me.ready,
        playing: running && !!matchView?.standings.some((s) => s.you),
      },
      start,
      match: matchView,
    };
  }

  /** The next moment something changes in the room by itself (a round starts or ends), if any. */
  nextEvent(code: string): number | undefined {
    const room = this.room(code);
    const match = room && this.latestMatch(room.id);
    if (!match || match.finishedAt !== null) return undefined;
    const r = this.rounds(match.id).find((x) => x.endedAt === null);
    if (!r || r.startsAt === null) return undefined;
    const now = this.now();
    if (now < r.startsAt) return r.startsAt;
    if (now <= r.deadline!) return r.deadline! + 1;
    return r.deadline! + GRACE_MS + 1;
  }

  // Internals

  /**
   * Applies what is due: a round whose players have all finished, or whose deadline has passed,
   * ends (open attempts time out, except checks received in time that the judge is still on, for
   * a short grace), and the next round is given its start. The last round ends the match.
   */
  private settleRoom(room: RoomRow) {
    const match = this.latestMatch(room.id);
    if (!match || match.finishedAt !== null) return;
    transaction(this.db, () => {
      const now = this.now();
      for (;;) {
        const rounds = this.rounds(match.id);
        const r = rounds.find((x) => x.endedAt === null);
        if (!r) {
          const last = rounds.at(-1)!;
          this.db.prepare('UPDATE matches SET finished_at = ? WHERE id = ?').run(last.endedAt, match.id);
          return;
        }
        if (r.startsAt === null || now < r.startsAt) return;
        const attempts = this.attempts(match.id, r.number);
        const open = attempts.filter((a) => a.status === 'open');
        if (open.length) {
          if (now <= r.deadline!) return;
          const pending = open.some((a) => a.submittedAt !== null && a.submittedAt <= r.deadline!);
          if (pending && now <= r.deadline! + GRACE_MS) return;
          this.db
            .prepare("UPDATE attempts SET status = 'timeout', resolved_at = ? WHERE match_id = ? AND round = ? AND status = 'open'")
            .run(pending ? r.deadline! + GRACE_MS : r.deadline!, match.id, r.number);
        }
        const ended = Math.max(
          r.startsAt,
          ...this.attempts(match.id, r.number).map((a) => a.resolvedAt ?? r.startsAt!),
        );
        this.db.prepare('UPDATE rounds SET ended_at = ? WHERE match_id = ? AND number = ?').run(ended, match.id, r.number);
        const next = rounds.find((x) => x.number === r.number + 1);
        if (next) {
          // After a restart that missed the end, the break starts now rather than in the past.
          const startsAt = Math.max(ended, now) + BREAK_MS;
          this.db
            .prepare('UPDATE rounds SET starts_at = ?, deadline = ? WHERE match_id = ? AND number = ?')
            .run(startsAt, startsAt + availableMs(next.referenceMs), match.id, next.number);
        }
      }
    });
  }

  private matchView(match: MatchRow, viewer: string | undefined, members: MemberRow[], now: number): MatchView {
    const players = this.db.prepare('SELECT player, name FROM match_players WHERE match_id = ?').all(match.id) as { player: string; name: string }[];
    const nameOf = new Map(players.map((p) => [p.player, p.name]));
    const away = (player: string) => {
      const m = members.find((x) => x.player === player);
      return !m || now - m.seenAt >= AWAY_MS;
    };
    const rounds = this.rounds(match.id);
    const ended = rounds.filter((r) => r.endedAt !== null);
    const tallies = new Map<string, Tally>(players.map((p) => [p.player, { player: p.player, name: p.name, points: 0, solves: 0, seconds: 0 }]));
    const past: RoundResult[] = ended.map((r) => {
      const attempts = this.attempts(match.id, r.number);
      for (const a of attempts) {
        const t = tallies.get(a.player);
        if (!t || a.status !== 'solved') continue;
        t.points += a.base + a.bonus;
        t.solves += 1;
        t.seconds += Math.floor(a.ms! / 1000);
      }
      const task = this.task(r.taskId);
      return {
        number: r.number,
        taskId: r.taskId,
        title: task?.title ?? r.taskId,
        text: r.text,
        level: r.level,
        results: attempts.map((a) => ({
          name: nameOf.get(a.player) ?? '?',
          you: a.player === viewer,
          status: a.status,
          ms: a.ms ?? undefined,
          base: a.base,
          bonus: a.bonus,
        })),
      };
    });

    const current = rounds.find((r) => r.endedAt === null && r.startsAt !== null);
    let round: RoundView | undefined;
    if (current) {
      const attempts = this.attempts(match.id, current.number);
      const mine = attempts.find((a) => a.player === viewer);
      const started = now >= current.startsAt!;
      const text = started && mine ? this.taskText(current) : undefined;
      round = {
        number: current.number,
        level: current.level,
        base: LEVEL_BASE[current.level]!,
        referenceMs: current.referenceMs,
        availableMs: current.deadline! - current.startsAt!,
        startsAt: current.startsAt!,
        deadline: current.deadline!,
        task: text && {
          id: text.id,
          version: text.version,
          text: current.text,
          title: text.title,
          prompt: text.prompt,
          initial: text.initial,
          expected: text.expected,
        },
        statuses: attempts.map((a) => ({ name: nameOf.get(a.player) ?? '?', you: a.player === viewer, away: away(a.player), status: a.status })),
        mine: mine && {
          status: mine.status,
          keys: started ? (JSON.parse(mine.keys) as string[]) : [],
          checks: mine.checks,
          ms: mine.ms ?? undefined,
          base: mine.base,
          bonus: mine.bonus,
        },
      };
    }

    return {
      number: match.number,
      rounds: rounds.length,
      startedAt: match.startedAt,
      standings: standings([...tallies.values()]).map((s) => ({ ...s, you: s.player === viewer, player: '' })),
      round,
      past,
    };
  }

  private startPermission(room: RoomRow, members: MemberRow[], player: string): 'ok' | 'not-member' | 'not-host' | 'running' {
    const me = members.find((m) => m.player === player);
    if (!me) return 'not-member';
    const match = this.latestMatch(room.id);
    if (match && match.finishedAt === null) return 'running';
    if (room.host === player) return 'ok';
    const now = this.now();
    const host = members.find((m) => m.player === room.host);
    if (host && now - host.seenAt < HOST_AWAY_MS) return 'not-host';
    const first = members.filter((m) => m.player !== room.host && now - m.seenAt < AWAY_MS).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    return first?.player === player ? 'ok' : 'not-host';
  }

  /** Tasks for the rounds of a new match: by level, avoiding tasks the room has played. */
  private pickRounds(room: RoomRow): { task: BankTask; text: number }[] {
    const levels = [...new Set(this.tasks.map((t) => t.level))].sort((a, b) => a - b);
    const played = new Set(
      (this.db.prepare('SELECT DISTINCT r.task_id FROM rounds r JOIN matches m ON m.id = r.match_id WHERE m.room_id = ?').all(room.id) as { task_id: string }[]).map(
        (r) => r.task_id,
      ),
    );
    const picked: { task: BankTask; text: number }[] = [];
    for (let i = 0; i < room.rounds; i++) {
      const level =
        room.level === 'mixed' ? levels[Math.floor((i * levels.length) / room.rounds)]! : nearest(levels, Number(room.level));
      const atLevel = this.tasks.filter((t) => t.level === level);
      const fresh = atLevel.filter((t) => !played.has(t.id) && !picked.some((p) => p.task.id === t.id));
      const unused = atLevel.filter((t) => !picked.some((p) => p.task.id === t.id));
      const pool = fresh.length ? fresh : unused.length ? unused : atLevel;
      const task = pool[this.random(pool.length)]!;
      picked.push({ task, text: 1 + this.random(textCount(task)) });
    }
    return picked;
  }

  private playing(code: string, player: Player, round: number): Playing {
    const room = this.room(code);
    if (!room) return { error: 'not-found' };
    this.settleRoom(room);
    const match = this.latestMatch(room.id);
    if (!match) return { error: 'not-playing' };
    const r = this.rounds(match.id).find((x) => x.number === round);
    const attempt = r && this.attempt(match.id, round, player.id);
    if (!r || !attempt) return { error: 'not-playing' };
    if (r.startsAt === null) return { error: 'not-started' };
    return { matchId: match.id, r, attempt };
  }

  private taskText(r: RoundRow): BankTask | undefined {
    const task = this.task(r.taskId);
    return task && onText(task, r.text);
  }

  private task(id: string): BankTask | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  private newCode(): string {
    for (;;) {
      const bytes = randomBytes(CODE_LENGTH);
      const code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
      if (!this.db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(code)) return code;
    }
  }

  private touchRoom(id: string) {
    this.db.prepare('UPDATE rooms SET touched_at = ? WHERE id = ?').run(this.now(), id);
  }

  private room(code: string): RoomRow | undefined {
    if (typeof code !== 'string' || code.length !== CODE_LENGTH) return undefined;
    const r = this.db.prepare('SELECT id, code, host, rounds, level FROM rooms WHERE code = ?').get(code);
    return r && { id: String(r.id), code: String(r.code), host: String(r.host), rounds: Number(r.rounds), level: r.level as LevelChoice };
  }

  private member(roomId: string, player: string): MemberRow | undefined {
    return this.members(roomId).find((m) => m.player === player);
  }

  private members(roomId: string): MemberRow[] {
    return this.db
      .prepare('SELECT player, user_id, name, ready, joined_at, seen_at FROM room_members WHERE room_id = ? ORDER BY joined_at')
      .all(roomId)
      .map((r) => ({
        player: String(r.player),
        userId: (r.user_id as string | null) ?? null,
        name: String(r.name),
        ready: Number(r.ready) === 1,
        joinedAt: Number(r.joined_at),
        seenAt: Number(r.seen_at),
      }));
  }

  private latestMatch(roomId: string): MatchRow | undefined {
    const r = this.db.prepare('SELECT id, number, started_at, finished_at FROM matches WHERE room_id = ? ORDER BY number DESC LIMIT 1').get(roomId);
    return r && { id: String(r.id), number: Number(r.number), startedAt: Number(r.started_at), finishedAt: num(r.finished_at) };
  }

  private rounds(matchId: string): RoundRow[] {
    return this.db
      .prepare('SELECT * FROM rounds WHERE match_id = ? ORDER BY number')
      .all(matchId)
      .map((r: Row) => ({
        number: Number(r.number),
        taskId: String(r.task_id),
        taskVersion: Number(r.task_version),
        text: Number(r.text),
        level: Number(r.level),
        referenceMs: Number(r.reference_ms),
        startsAt: num(r.starts_at),
        deadline: num(r.deadline),
        endedAt: num(r.ended_at),
      }));
  }

  private attempts(matchId: string, round: number): AttemptRow[] {
    return this.db
      .prepare('SELECT a.* FROM attempts a JOIN match_players p ON p.match_id = a.match_id AND p.player = a.player WHERE a.match_id = ? AND a.round = ? ORDER BY p.rowid')
      .all(matchId, round)
      .map(toAttempt);
  }

  private attempt(matchId: string, round: number, player: string): AttemptRow | undefined {
    const r = this.db.prepare('SELECT * FROM attempts WHERE match_id = ? AND round = ? AND player = ?').get(matchId, round, player);
    return r && toAttempt(r);
  }
}

const toAttempt = (r: Row): AttemptRow => ({
  player: String(r.player),
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

function phaseOf(round: RoundView | undefined, now: number, ended: number): Phase {
  if (!round) return 'break';
  if (now >= round.startsAt) return 'round';
  return ended === 0 ? 'countdown' : 'break';
}

/** The available level closest to the one asked for. */
function nearest(levels: number[], want: number): number {
  return levels.reduce((best, l) => (Math.abs(l - want) < Math.abs(best - want) ? l : best), levels[0]!);
}

export function validSettings(s: RoomSettings): boolean {
  return Number.isInteger(s.rounds) && s.rounds >= 1 && s.rounds <= MAX_ROUNDS && ['mixed', '1', '2', '3', '4', '5'].includes(s.level);
}
