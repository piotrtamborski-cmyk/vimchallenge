/** The signed-in player in server components (pages and the layout). */
import type { User } from '@vimchallenge/accounts';
import { cookies } from 'next/headers';
import { authConfig, authContext } from './context.ts';
import { sessionCookie } from './cookies.ts';

export async function currentUser(): Promise<User | undefined> {
  const token = (await cookies()).get(sessionCookie(authConfig().secure))?.value;
  return token ? authContext().accounts.sessionUser(token) : undefined;
}

/** Sign-in methods this site offers, in the order of the sign-in page. */
export function signInMethods(): { github: boolean; google: boolean; email: boolean } {
  const config = authConfig();
  return { github: !!config.github, google: !!config.google, email: !!config.mailer };
}

/** The signed-in player's solves of a task, for the task page. */
export async function taskProgress(taskId: string): Promise<{ best: number; solves: number } | undefined> {
  const user = await currentUser();
  const p = user && authContext().accounts.progress(user.id).get(taskId);
  return p && { best: p.best, solves: p.solves };
}

/** Ids of the tasks the signed-in player has solved. */
export async function solvedTasks(): Promise<Set<string>> {
  const user = await currentUser();
  return new Set(user ? authContext().accounts.progress(user.id).keys() : []);
}
