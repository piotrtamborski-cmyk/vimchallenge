/**
 * Corrections of the daily challenge, for the operator (plany/03, "Wiarygodność i korekty"):
 *
 *   node packages/daily/src/admin.ts <database> show <day>
 *   node packages/daily/src/admin.ts <database> void <day> <position> <reason>
 *   node packages/daily/src/admin.ts <database> restore <day> <position> <reason>
 *   node packages/daily/src/admin.ts <database> rebuild <day>
 *
 * `void` takes a faulty task out of the day for every run and rebuilds the day's entries, so the
 * daily, weekly, monthly and all-time tables all follow; the entries as they were are kept with the
 * correction. `restore` undoes a void (runs that started after the void never got the task, so it
 * gives them nothing). `rebuild` works out a day's entries again from its attempts.
 */
import { fileURLToPath } from 'node:url';
import { openDatabase } from '@vimchallenge/accounts';
import { JudgeUnavailable } from '@vimchallenge/rooms';
import { Daily } from './daily.ts';
import { validDay } from './periods.ts';

export function run(args: string[], print: (line: string) => void = console.log): number {
  const [database, command, day, position, ...reason] = args;
  const usage = () => {
    print('usage: admin.ts <database> show|rebuild <day>  |  admin.ts <database> void|restore <day> <position> <reason>');
    return 2;
  };
  if (!database || !command || !day || !validDay(day)) return usage();
  const db = openDatabase(database);
  try {
    const daily = new Daily(db, {
      judge: async () => {
        throw new JudgeUnavailable('no judge in the admin tool');
      },
    });
    if (command === 'show') {
      const tasks = db.prepare('SELECT position, task_id, text, level, voided_at FROM daily_tasks WHERE day = ? ORDER BY position').all(day);
      if (!tasks.length) {
        print(`${day}: no set`);
        return 1;
      }
      for (const t of tasks)
        print(`${t.position}. level ${t.level}  ${t.task_id} text ${t.text}${t.voided_at === null ? '' : '  VOIDED'}`);
      const runs = db.prepare('SELECT count(*) AS n, sum(finished_at IS NULL) AS open FROM daily_runs WHERE day = ?').get(day)!;
      print(`runs: ${runs.n} (${runs.open ?? 0} not finished)`);
      for (const c of daily.corrections(day)) print(`${new Date(c.at).toISOString()} ${c.action} ${c.position}: ${c.reason}`);
      return 0;
    }
    if (command === 'rebuild') {
      daily.rebuild(day);
      print(`${day}: entries rebuilt`);
      return 0;
    }
    if (command !== 'void' && command !== 'restore') return usage();
    const n = Number(position);
    const why = reason.join(' ').trim();
    if (!Number.isInteger(n) || !why) return usage();
    const result = daily.correct(day, n, command, why);
    print(result === 'ok' ? `${day}: task ${n} ${command === 'void' ? 'voided' : 'restored'}, entries rebuilt` : `${day}: ${result}`);
    return result === 'ok' ? 0 : 1;
  } finally {
    db.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = run(process.argv.slice(2));
