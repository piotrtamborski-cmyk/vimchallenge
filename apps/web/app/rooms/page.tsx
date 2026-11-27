import { LEVEL_BASE, tasks } from '@vimchallenge/tasks';
import type { Metadata } from 'next';
import { Message } from '@/components/Messages';
import { NAME_RULES } from '@/lib/auth/messages';
import { pagePlayer } from '@/lib/rooms/page';

export const metadata: Metadata = { title: 'Rooms' };

const ERROR: Record<string, string> = {
  'name-invalid': NAME_RULES,
  settings: 'Choose from 1 to 5 rounds and a level.',
  rate: 'Too many rooms from your network just now. Please wait a few minutes.',
  'not-found': 'There is no room with that code. It may have expired: rooms are deleted a week after their last game.',
};

type Props = { searchParams: Promise<{ error?: string }> };

const field = 'rounded border border-line bg-panel px-3 py-1.5';

export default async function RoomsPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const { name } = await pagePlayer();
  const levels = [...new Set(tasks.map((t) => t.level))].sort();
  return (
    <div className="max-w-2xl space-y-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Rooms</h1>
        <p className="text-lg text-muted">
          Play the same tasks with friends at the same moment. Everyone gets the same text; every correct solve scores, and
          faster solves score more. No account needed.
        </p>
        <Message error={error ? (ERROR[error] ?? 'Something went wrong. Please try again.') : undefined} />
      </header>

      <section aria-labelledby="create" className="space-y-3">
        <h2 id="create" className="text-lg font-semibold">
          Start a room
        </h2>
        <form method="post" action="/api/rooms" className="flex flex-wrap items-end gap-4">
          <label className="space-y-1">
            <span className="block text-sm text-muted">Your name in the room</span>
            <input name="name" required minLength={3} maxLength={24} pattern="[A-Za-z0-9][A-Za-z0-9_\-]*" defaultValue={name} className={`${field} font-mono`} />
          </label>
          <label className="space-y-1">
            <span className="block text-sm text-muted">Rounds</span>
            <select name="rounds" defaultValue="3" className={field}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="block text-sm text-muted">Tasks</span>
            <select name="level" defaultValue="mixed" className={field}>
              <option value="mixed">Rising levels</option>
              {levels.map((l) => (
                <option key={l} value={String(l)}>
                  Level {l} ({LEVEL_BASE[l]} points)
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink">
            Create room
          </button>
        </form>
        <p className="text-sm text-muted">You get a link to send to up to seven others. The room keeps the same link for later matches.</p>
      </section>

      <section aria-labelledby="join" className="space-y-3">
        <h2 id="join" className="text-lg font-semibold">
          Join with a code
        </h2>
        <form method="get" action="/rooms/go" className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-sm text-muted">Room code</span>
            <input name="code" required maxLength={40} autoComplete="off" spellCheck={false} className={`${field} font-mono`} />
          </label>
          <button type="submit" className="rounded border border-line px-4 py-2 hover:bg-line/40">
            Go to room
          </button>
        </form>
      </section>

      <section aria-labelledby="points" className="space-y-2 leading-relaxed">
        <h2 id="points" className="text-lg font-semibold">
          How a match is scored
        </h2>
        <p>
          A correct solve earns the points of its level: {levels.map((l) => `${LEVEL_BASE[l]} (level ${l})`).join(', ')}. A solve within
          the task&apos;s reference time earns a quarter more; the bonus then shrinks to nothing at twice that time. A round lasts four
          times the reference time (at least one minute), or ends sooner once everyone has finished.
        </p>
        <p>
          A check that fails costs nothing, but the clock keeps running. The time that counts is when the server received your
          check. The standings rank players by points, then by solves, then by the time spent on the solves.
        </p>
      </section>
    </div>
  );
}
