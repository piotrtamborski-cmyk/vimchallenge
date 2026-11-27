/**
 * Days, weeks and months of the league, all in UTC (plany/03): a day is a calendar day in UTC, a
 * week runs from Monday 00:00 UTC, a month is a calendar month in UTC. Days are written
 * `YYYY-MM-DD`, months `YYYY-MM`; a week is named by its Monday.
 */

export type Period = 'day' | 'week' | 'month' | 'all';
export const PERIODS: readonly Period[] = ['day', 'week', 'month', 'all'];

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

/** The UTC day of a moment. */
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** 00:00 UTC of a day. */
export const dayStart = (day: string): number => Date.parse(`${day}T00:00:00Z`);

export const addDays = (day: string, n: number): string => dayOf(dayStart(day) + n * DAY_MS);

/** A real day written as `YYYY-MM-DD` (not 2026-02-30). */
export const validDay = (day: string): boolean => DAY_RE.test(day) && dayOf(dayStart(day) || 0) === day;

/** The Monday of the day's week. */
export function weekOf(day: string): string {
  const weekday = new Date(dayStart(day)).getUTCDay(); // 0 is Sunday
  return addDays(day, -((weekday + 6) % 7));
}

export const monthOf = (day: string): string => day.slice(0, 7);

/** The period of a kind that contains a day, by its key. */
export function periodKey(period: Period, day: string): string {
  if (period === 'day') return day;
  if (period === 'week') return weekOf(day);
  if (period === 'month') return monthOf(day);
  return 'all';
}

/** First and last day of a period; undefined for a key that names none. */
export function periodDays(period: Period, key: string): { first: string; last: string } | undefined {
  if (period === 'all') return key === 'all' ? { first: '0000-01-01', last: '9999-12-31' } : undefined;
  if (period === 'day') return validDay(key) ? { first: key, last: key } : undefined;
  if (period === 'week') return validDay(key) && weekOf(key) === key ? { first: key, last: addDays(key, 6) } : undefined;
  if (!MONTH_RE.test(key) || !validDay(`${key}-01`)) return undefined;
  const next = new Date(dayStart(`${key}-01`));
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { first: `${key}-01`, last: addDays(dayOf(next.getTime()), -1) };
}

/** The period before or after one, by key (undefined for 'all'). */
export function shiftPeriod(period: Period, key: string, by: -1 | 1): string | undefined {
  const days = periodDays(period, key);
  if (!days || period === 'all') return undefined;
  return periodKey(period, by < 0 ? addDays(days.first, -1) : addDays(days.last, 1));
}
