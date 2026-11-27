import { LEVEL_BASE, tasks } from '@vimchallenge/tasks';
import type { Metadata } from 'next';
import { Message } from '@/components/Messages';
import { i18nFor } from '@/lib/i18n/server';
import { roomError } from '@/lib/rooms/messages';
import { pagePlayer } from '@/lib/rooms/page';

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<{ error?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: i18nFor((await params).lang).m.rooms.title };
}

const field = 'rounded border border-line bg-panel px-3 py-1.5';

export default async function RoomsPage({ params, searchParams }: Props) {
  const i = i18nFor((await params).lang);
  const { m, t } = i;
  const r = m.rooms;
  const { error } = await searchParams;
  const { name } = await pagePlayer();
  const levels = [...new Set(tasks.map((task) => task.level))].sort();
  return (
    <div className="max-w-2xl space-y-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{r.title}</h1>
        <p className="text-lg text-muted">{r.intro}</p>
        <Message error={error === 'rate' ? r.error.rate : roomError(i, error)} />
      </header>

      <section aria-labelledby="create" className="space-y-3">
        <h2 id="create" className="text-lg font-semibold">
          {r.create}
        </h2>
        <form method="post" action="/api/rooms" className="flex flex-wrap items-end gap-4">
          <label className="space-y-1">
            <span className="block text-sm text-muted">{r.yourName}</span>
            <input name="name" required minLength={3} maxLength={24} pattern="[A-Za-z0-9][A-Za-z0-9_\-]*" defaultValue={name} className={`${field} font-mono`} />
          </label>
          <label className="space-y-1">
            <span className="block text-sm text-muted">{r.rounds}</span>
            <select name="rounds" defaultValue="3" className={field}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-sm text-muted">{r.tasks}</span>
            <select name="level" defaultValue="mixed" className={field}>
              <option value="mixed">{r.rising}</option>
              {levels.map((l) => (
                <option key={l} value={String(l)}>
                  {t(r.levelOption, { level: l, points: LEVEL_BASE[l]! })}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink">
            {r.createButton}
          </button>
        </form>
        <p className="text-sm text-muted">{r.createNote}</p>
      </section>

      <section aria-labelledby="join" className="space-y-3">
        <h2 id="join" className="text-lg font-semibold">
          {r.join}
        </h2>
        <form method="get" action={i.href('/rooms/go')} className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-sm text-muted">{r.code}</span>
            <input name="code" required maxLength={40} autoComplete="off" spellCheck={false} className={`${field} font-mono`} />
          </label>
          <button type="submit" className="rounded border border-line px-4 py-2 hover:bg-line/40">
            {r.go}
          </button>
        </form>
      </section>

      <section aria-labelledby="points" className="space-y-2 leading-relaxed">
        <h2 id="points" className="text-lg font-semibold">
          {r.scoringTitle}
        </h2>
        <p>{t(r.scoringPoints, { levels: i.list(levels.map((l) => t(r.levelPoints, { points: LEVEL_BASE[l]!, level: l }))) })}</p>
        <p>{r.scoringChecks}</p>
      </section>
    </div>
  );
}
