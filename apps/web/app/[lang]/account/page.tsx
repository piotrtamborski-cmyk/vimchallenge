import { NAME_MAX, NAME_MIN, type Identity } from '@vimchallenge/accounts';
import { taskById, tasks, textCount } from '@vimchallenge/tasks';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Message } from '@/components/Messages';
import { authContext } from '@/lib/auth/context';
import { errorMessage, noticeMessage } from '@/lib/auth/messages';
import { currentUser, signInMethods } from '@/lib/auth/session';
import { dailyContext } from '@/lib/daily/context';
import { i18nFor } from '@/lib/i18n/server';

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<{ error?: string; notice?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: i18nFor((await params).lang).m.account.title };
}

const button = 'rounded border border-line px-3 py-1.5 hover:bg-line/40';
const b = (text: React.ReactNode) => <strong className="text-ink">{text}</strong>;

export default async function AccountPage({ params, searchParams }: Props) {
  const i = i18nFor((await params).lang);
  const { m, t, href } = i;
  const a = m.account;
  const user = await currentUser();
  if (!user) redirect(`${href('/sign-in')}?next=${encodeURIComponent(href('/account'))}`);
  const describeIdentity = (id: Identity) => (id.provider === 'email' ? id.subject : (id.email ?? a.connected));
  const dailyLink = (text: React.ReactNode) => (
    <Link href={href('/daily')} className="underline">
      {text}
    </Link>
  );
  const { error, notice } = await searchParams;
  const { accounts } = authContext();
  const identities = accounts.identities(user.id);
  const progress = accounts.progress(user.id);
  const history = accounts.history(user.id, 10);
  const sessions = accounts.sessionCount(user.id);
  const methods = signInMethods();
  const has = (p: string) => identities.some((i) => i.provider === p);
  const solved = tasks.filter((t) => progress.has(t.id));
  const onBoards = accounts.onBoards(user.id);
  const league = dailyContext().board('all', 'all', user.id)?.you;

  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{a.title}</h1>
        <p className="text-muted">{i.rich(a.signedInAs, { b, name: user.name })}</p>
        <Message error={errorMessage(i, error)} notice={noticeMessage(i, notice)} />
      </header>

      <section aria-labelledby="progress" className="space-y-3">
        <h2 id="progress" className="text-lg font-semibold">
          {a.progress}
        </h2>
        <p>
          {t(a.solvedOf, { solved: solved.length, total: tasks.length })}{' '}
          {solved.length === 0 && (
            <Link href={href('/tasks')} className="underline">
              {a.startTask}
            </Link>
          )}
        </p>
        {solved.length > 0 && (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-sm text-muted">
                <th className="py-1 pr-4 font-normal">{a.task}</th>
                <th className="py-1 pr-4 font-normal">{a.fewestKeys}</th>
                <th className="py-1 pr-4 font-normal">{a.textsSolved}</th>
                <th className="py-1 font-normal">{a.solves}</th>
              </tr>
            </thead>
            <tbody>
              {solved.map((task) => {
                const p = progress.get(task.id)!;
                return (
                  <tr key={task.id} className="border-t border-line">
                    <td className="py-2 pr-4">
                      <Link href={href(`/tasks/${task.id}`)} className="underline">
                        {task.title}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 font-mono">{p.best}</td>
                    <td className="py-2 pr-4 font-mono">{t(a.textsOf, { n: p.texts, count: textCount(task) })}</td>
                    <td className="py-2 font-mono">{p.solves}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {history.length > 0 && (
          <details>
            <summary className="cursor-pointer">{a.recent}</summary>
            <ul className="mt-2 space-y-1 text-sm">
              {history.map((s) => (
                <li key={`${s.solvedAt}-${s.taskId}-${s.text}`}>
                  <span className="font-mono text-muted">{i.utc(s.solvedAt)}</span> ·{' '}
                  {t(a.recentItem, { task: taskById(s.taskId)?.title ?? s.taskId, text: s.text, keys: t(m.common.keys, { n: s.keys }) })}
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="text-sm text-muted">{a.keptNote}</p>
      </section>

      <section aria-labelledby="name" className="space-y-3">
        <h2 id="name" className="text-lg font-semibold">
          {a.name}
        </h2>
        <p id="name-rules" className="text-sm text-muted">
          {t(a.nameRules, { min: NAME_MIN, max: NAME_MAX })}
        </p>
        <form method="post" action="/api/account/name" className="flex flex-wrap gap-3">
          <label>
            <span className="sr-only">{a.name}</span>
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

      <section aria-labelledby="leaderboards" className="space-y-3">
        <h2 id="leaderboards" className="text-lg font-semibold">
          {a.leaderboards}
        </h2>
        <p>
          {league
            ? i.rich(a.played, { n: league.days, points: league.points, rank: league.rank, link: dailyLink })
            : i.rich(a.notPlayed, { link: dailyLink })}
        </p>
        <form method="post" action="/api/account/boards" className="space-y-3">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="boards" value="on" defaultChecked={onBoards === true} className="mt-1" />
            <span>
              {a.show}
              <span className="block text-sm text-muted">{a.showNote}</span>
            </span>
          </label>
          <button type="submit" className={button}>
            Save
          </button>
        </form>
      </section>

      <section aria-labelledby="methods" className="space-y-3">
        <h2 id="methods" className="text-lg font-semibold">
          {a.methods}
        </h2>
        <ul className="space-y-2">
          {identities.map((id) => (
            <li key={`${id.provider}:${id.subject}`} className="flex flex-wrap items-center gap-3">
              <span className="font-semibold">{a.methodName[id.provider as keyof typeof a.methodName]}</span>
              <span className="text-muted">{describeIdentity(id)}</span>
              {identities.length > 1 && (
                <form method="post" action="/api/account/disconnect">
                  <input type="hidden" name="provider" value={id.provider} />
                  <input type="hidden" name="subject" value={id.subject} />
                  <button type="submit" className={`${button} text-sm`}>
                    {a.disconnect}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          {methods.github && !has('github') && (
            <a href="/api/auth/github/start?link=1" className={button}>
              {a.connectGithub}
            </a>
          )}
          {methods.google && !has('google') && (
            <a href="/api/auth/google/start?link=1" className={button}>
              {a.connectGoogle}
            </a>
          )}
        </div>
        {methods.email && (
          <form method="post" action="/api/auth/email" className="space-y-1">
            <input type="hidden" name="link" value="1" />
            <label htmlFor="add-email" className="block text-sm text-muted">
              {a.addEmail}
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
                {a.sendLink}
              </button>
            </div>
          </form>
        )}
      </section>

      <section aria-labelledby="devices" className="space-y-3">
        <h2 id="devices" className="text-lg font-semibold">
          {a.devices}
        </h2>
        <p>{t(a.signedInOn, { n: sessions })}</p>
        <div className="flex flex-wrap gap-3">
          <form method="post" action="/api/auth/sign-out">
            <button type="submit" className={button}>
              {a.signOut}
            </button>
          </form>
          {sessions > 1 && (
            <form method="post" action="/api/account/sessions">
              <button type="submit" className={button}>
                {a.signOutOthers}
              </button>
            </form>
          )}
        </div>
      </section>

      <section aria-labelledby="delete" className="space-y-3">
        <h2 id="delete" className="text-lg font-semibold">
          {a.delete}
        </h2>
        <form method="post" action="/api/account/delete" className="space-y-3">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="confirm" value="delete" required className="mt-1" />
            <span>{a.deleteConfirm}</span>
          </label>
          <button type="submit" className="rounded border border-bad px-3 py-1.5 text-bad hover:bg-bad/10">
            {a.delete}
          </button>
        </form>
      </section>
    </div>
  );
}
