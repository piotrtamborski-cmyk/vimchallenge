/**
 * A restore drill for the operator (deploy/README.md, "Restore drill"):
 *
 *   node packages/daily/src/restore-check.ts <backup> [<live database>]
 *
 * Copies the backup to a scratch file (the backup itself is never written) and opens the copy as
 * this release would, migrating it if it is older. Then it:
 * - checks the copy and counts the rows of every table;
 * - works out every leaderboard twice: as the copy has it, and after rebuilding each day's entries
 *   from its attempts. The two must match, so the tables can always be recovered from the attempts.
 *
 * With the live database, it also sets the copy's row counts and entries beside the live ones.
 * The live file is opened read-only. At a quiet moment right after a backup they are equal; later
 * the live side has more.
 *
 * Prints how long the restore took. Exits with 1 when the copy is damaged or the rebuilt tables
 * differ, and with 2 on wrong use.
 */
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '@vimchallenge/accounts';
import { JudgeUnavailable } from '@vimchallenge/rooms';
import { Daily, PAGE_SIZE } from './daily.ts';
import { monthOf, type Period, weekOf } from './periods.ts';

const sqlite = process.getBuiltinModule('node:sqlite');

export interface RestoreReport {
  ms: number;
  counts: Record<string, number>;
  days: number;
  /** Tables compared before and after the rebuild (each day, week and month, and all time). */
  boards: number;
  /** Tables, or `entries`, that differ after the rebuild; empty when the drill passed. */
  differences: string[];
  live?: { counts: Record<string, number>; sameEntries: boolean };
}

function tableCounts(db: DatabaseSync): Record<string, number> {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return Object.fromEntries(names.map(({ name }) => [String(name), Number(db.prepare(`SELECT count(*) AS n FROM "${String(name)}"`).get()!.n)]));
}

const entries = (db: DatabaseSync) =>
  JSON.stringify(db.prepare('SELECT day, user_id, points, solves, seconds, max_points, league FROM daily_entries ORDER BY day, user_id').all());

/** Every table of the period, all pages, as text to compare. */
function boardText(daily: Daily, period: Period, key: string): string {
  const pages: unknown[] = [];
  for (let page = 0; ; page++) {
    const board = daily.board(period, key, undefined, page);
    if (!board) break;
    pages.push(board.rows);
    if (page + 1 >= board.pages) break;
  }
  return JSON.stringify(pages);
}

export function restoreCheck(backup: string, live?: string, now?: () => number): RestoreReport {
  const started = performance.now();
  const dir = mkdtempSync(join(tmpdir(), 'vc-restore-'));
  try {
    const copy = join(dir, 'accounts.db');
    copyFileSync(backup, copy);
    const db = openDatabase(copy);
    try {
      const integrity = db.prepare('PRAGMA integrity_check').all();
      if (integrity.length !== 1 || integrity[0]!.integrity_check !== 'ok') throw new Error(`the copy is damaged: ${JSON.stringify(integrity)}`);
      const daily = new Daily(db, {
        judge: async () => {
          throw new JudgeUnavailable('no judge in a restore check');
        },
        now,
      });
      const days = db.prepare('SELECT day FROM daily_sets ORDER BY day').all().map((r) => String(r.day));
      const keys: [Period, string][] = [
        ...days.map((d) => ['day', d] as [Period, string]),
        ...[...new Set(days.map(weekOf))].map((w) => ['week', w] as [Period, string]),
        ...[...new Set(days.map(monthOf))].map((m) => ['month', m] as [Period, string]),
        ['all', 'all'],
      ];
      // Reading a table settles the days that are over, as the site would.
      const before = new Map(keys.map(([p, k]) => [`${p} ${k}`, boardText(daily, p, k)]));
      const entriesBefore = entries(db);
      const ms = performance.now() - started;

      for (const d of days) daily.rebuild(d);
      const differences = keys.map(([p, k]) => `${p} ${k}`).filter((name, i) => boardText(daily, keys[i]![0], keys[i]![1]) !== before.get(name));
      if (entries(db) !== entriesBefore) differences.push('entries');

      const report: RestoreReport = { ms, counts: tableCounts(db), days: days.length, boards: keys.length, differences };
      if (live) {
        const l = new sqlite.DatabaseSync(live, { readOnly: true });
        try {
          report.live = { counts: tableCounts(l), sameEntries: entries(l) === entriesBefore };
        } finally {
          l.close();
        }
      }
      return report;
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function run(args: string[], print: (line: string) => void = console.log): number {
  const [backup, live] = args;
  if (!backup) {
    print('usage: restore-check.ts <backup> [<live database>]');
    return 2;
  }
  let report: RestoreReport;
  try {
    report = restoreCheck(backup, live);
  } catch (err) {
    print(`restore failed: ${(err as Error).message}`);
    return 1;
  }
  print(`restored and opened in ${Math.round(report.ms)} ms`);
  const width = Math.max(...Object.keys(report.counts).map((n) => n.length));
  print(`${'table'.padEnd(width)}  copy${report.live ? '    live' : ''}`);
  for (const [name, n] of Object.entries(report.counts))
    print(`${name.padEnd(width)}  ${String(n).padStart(4)}${report.live ? `  ${String(report.live.counts[name] ?? '–').padStart(6)}` : ''}`);
  if (report.live) print(`daily entries ${report.live.sameEntries ? 'equal the live ones' : 'differ from the live ones (fine if the site changed since the backup)'}`);
  print(`${report.days} days, ${report.boards} tables (${PAGE_SIZE} rows a page) compared before and after rebuilding every day from its attempts`);
  if (report.differences.length) {
    print(`DIFFERENT after the rebuild: ${report.differences.join(', ')}`);
    return 1;
  }
  print('the same after the rebuild');
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = run(process.argv.slice(2));
