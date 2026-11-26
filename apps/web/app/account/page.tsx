import { NAME_MAX, NAME_MIN, type Identity } from '@vimchallenge/accounts';
import { taskById, tasks, textCount } from '@vimchallenge/tasks';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Message } from '@/components/Messages';
import { authContext } from '@/lib/auth/context';
import { errorMessage, noticeMessage } from '@/lib/auth/messages';
import { currentUser, signInMethods } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Your account' };

type Props = { searchParams: Promise<{ error?: string; notice?: string }> };

const button = 'rounded border border-line px-3 py-1.5 hover:bg-line/40';
const METHOD: Record<string, string> = { email: 'Email link', github: 'GitHub', google: 'Google' };
const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

function describeIdentity(i: Identity): string {
  if (i.provider === 'email') return i.subject;
  return i.email ?? 'connected';
}

export default async function AccountPage({ searchParams }: Props) {
  const user = await currentUser();
  if (!user) redirect('/sign-in?next=/account');
  const { error, notice } = await searchParams;
  const { accounts } = authContext();
  const identities = accounts.identities(user.id);
  const progress = accounts.progress(user.id);
  const history = accounts.history(user.id, 10);
  const sessions = accounts.sessionCount(user.id);
  const methods = signInMethods();
  const has = (p: string) => identities.some((i) => i.provider === p);
  const solved = tasks.filter((t) => progress.has(t.id));

  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Your account</h1>
        <p className="text-muted">
          Signed in as <strong className="text-ink">{user.name}</strong>
        </p>
        <Message error={errorMessage(error)} notice={noticeMessage(notice)} />
      </header>

      <section aria-labelledby="progress" className="space-y-3">
        <h2 id="progress" className="text-lg font-semibold">
          Progress
        </h2>
        <p>
          You have solved {solved.length} of {tasks.length} tasks.{' '}
          {solved.length === 0 && (
            <Link href="/tasks" className="underline">
              Start with a task →
            </Link>
          )}
        </p>
        {solved.length > 0 && (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-sm text-muted">
                <th className="py-1 pr-4 font-normal">Task</th>
                <th className="py-1 pr-4 font-normal">Fewest keys</th>
                <th className="py-1 pr-4 font-normal">Texts solved</th>
                <th className="py-1 font-normal">Solves</th>
              </tr>
            </thead>
            <tbody>
              {solved.map((t) => {
                const p = progress.get(t.id)!;
                return (
                  <tr key={t.id} className="border-t border-line">
                    <td className="py-2 pr-4">
                      <Link href={`/tasks/${t.id}`} className="underline">
                        {t.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 font-mono">{p.best}</td>
                    <td className="py-2 pr-4 font-mono">
                      {p.texts} of {textCount(t)}
                    </td>
                    <td className="py-2 font-mono">{p.solves}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {history.length > 0 && (
          <details>
            <summary className="cursor-pointer">Recent solves</summary>
            <ul className="mt-2 space-y-1 text-sm">
              {history.map((s) => (
                <li key={`${s.solvedAt}-${s.taskId}-${s.text}`}>
                  <span className="font-mono text-muted">{when(s.solvedAt)}</span> · {taskById(s.taskId)?.title ?? s.taskId}, text {s.text} ·{' '}
                  {s.keys} keys
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="text-sm text-muted">Only solves the server confirmed are kept: the task, the text, the time and the number of keys. Never the keys.</p>
      </section>

      <section aria-labelledby="name" className="space-y-3">
        <h2 id="name" className="text-lg font-semibold">
          Name
        </h2>
        <p id="name-rules" className="text-sm text-muted">
          Shown to other players in rooms and leaderboards. {NAME_MIN} to {NAME_MAX} letters, digits, - or _.
        </p>
        <form method="post" action="/api/account/name" className="flex flex-wrap gap-3">
          <label>
            <span className="sr-only">Name</span>
            <input
              aria-describedby="name-rules"
              name="name"
              defaultValue={user.name}
              required
              minLength={NAME_MIN}
              maxLength={NAME_MAX}
              pattern="[A-Za-z0-9][A-Za-z0-9_\-]*"
              autoComplete="username"
              className="rounded border border-line bg-panel px-3 py-1.5 font-mono"
            />
          </label>
          <button type="submit" className={button}>
            Save
          </button>
        </form>
      </section>

      <section aria-labelledby="methods" className="space-y-3">
        <h2 id="methods" className="text-lg font-semibold">
          Ways to sign in
        </h2>
        <ul className="space-y-2">
          {identities.map((i) => (
            <li key={`${i.provider}:${i.subject}`} className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">{METHOD[i.provider]}</span>
              <span className="text-muted">{describeIdentity(i)}</span>
              {identities.length > 1 && (
                <form method="post" action="/api/account/disconnect">
                  <input type="hidden" name="provider" value={i.provider} />
                  <input type="hidden" name="subject" value={i.subject} />
                  <button type="submit" className={`${button} text-sm`}>
                    Disconnect
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          {methods.github && !has('github') && (
            <a href="/api/auth/github/start?link=1" className={button}>
              Connect GitHub
            </a>
          )}
          {methods.google && !has('google') && (
            <a href="/api/auth/google/start?link=1" className={button}>
              Connect Google
            </a>
          )}
        </div>
        {methods.email && (
          <form method="post" action="/api/auth/email" className="space-y-1">
            <input type="hidden" name="link" value="1" />
            <label htmlFor="add-email" className="block text-sm text-muted">
              Add an email address to sign in with a link
            </label>
            <div className="flex flex-wrap gap-3">
              <input
                id="add-email"
                type="email"
                name="email"
                required
                maxLength={254}
                autoComplete="email"
                className="rounded border border-line bg-panel px-3 py-1.5"
              />
              <button type="submit" className={button}>
                Send a link
              </button>
            </div>
          </form>
        )}
      </section>

      <section aria-labelledby="devices" className="space-y-3">
        <h2 id="devices" className="text-lg font-semibold">
          Devices
        </h2>
        <p>
          Signed in on {sessions} {sessions === 1 ? 'device' : 'devices'}. A device signs out by itself after 30 days without a visit.
        </p>
        <div className="flex flex-wrap gap-3">
          <form method="post" action="/api/auth/sign-out">
            <button type="submit" className={button}>
              Sign out
            </button>
          </form>
          {sessions > 1 && (
            <form method="post" action="/api/account/sessions">
              <button type="submit" className={button}>
                Sign out on every other device
              </button>
            </form>
          )}
        </div>
      </section>

      <section aria-labelledby="delete" className="space-y-3">
        <h2 id="delete" className="text-lg font-semibold">
          Delete the account
        </h2>
        <form method="post" action="/api/account/delete" className="space-y-3">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="confirm" value="delete" required className="mt-1" />
            <span>Delete my account, its sign-in methods and all my progress. This cannot be undone.</span>
          </label>
          <button type="submit" className="rounded border border-bad px-3 py-1.5 text-bad hover:bg-bad/10">
            Delete the account
          </button>
        </form>
      </section>
    </div>
  );
}
