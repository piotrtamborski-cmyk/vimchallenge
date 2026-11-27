/** The daily challenge of this process, on the accounts database, judged by the judge service. */
import { Daily } from '@vimchallenge/daily';
import { authContext } from '../auth/context.ts';
import { httpJudge } from '../rooms/judge.ts';
import type { DailyRouteContext } from './routes.ts';

const store = globalThis as typeof globalThis & { __vcDaily?: Daily };

export function dailyContext(): Daily {
  if (!store.__vcDaily) {
    const { accounts } = authContext();
    store.__vcDaily = new Daily(accounts.db, {
      judge: httpJudge(),
      onSolved: (userId, s) => accounts.recordSolve(userId, s),
    });
  }
  return store.__vcDaily;
}

/** Replaces the daily challenge of this process (tests). */
export function setDailyContext(daily: Daily | undefined): void {
  store.__vcDaily = daily;
}

export const dailyRouteContext = (): DailyRouteContext => ({ auth: authContext(), daily: dailyContext() });
