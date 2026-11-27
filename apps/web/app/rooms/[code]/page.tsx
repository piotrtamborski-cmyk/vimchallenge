import type { Metadata } from 'next';
import Link from 'next/link';
import { Message } from '@/components/Messages';
import { NAME_RULES } from '@/lib/auth/messages';
import { Room } from '@/components/Room';
import { authConfig } from '@/lib/auth/context';
import { roomsContext } from '@/lib/rooms/context';
import { pagePlayer } from '@/lib/rooms/page';

export const metadata: Metadata = { title: 'Room' };

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ error?: string }> };

const ERROR: Record<string, string> = {
  'name-invalid': NAME_RULES,
  'name-taken': 'Someone in this room already has that name.',
  full: 'This room is full: eight players at most.',
  rate: 'Too many joins from your network just now. Please wait a minute.',
};

export default async function RoomPage({ params, searchParams }: Props) {
  const { code } = await params;
  const { error } = await searchParams;
  const { player, name } = await pagePlayer();
  const view = roomsContext().view(code, player);
  if (!view)
    return (
      <div className="max-w-xl space-y-4">
        <h1 className="text-2xl font-semibold">No such room</h1>
        <p>The code is wrong, or the room expired: rooms are deleted a week after their last game.</p>
        <p>
          <Link href="/rooms" className="underline">
            Start a new room
          </Link>
        </p>
      </div>
    );
  if (view.you) return <Room initial={view} invite={new URL(`/rooms/${view.code}`, authConfig().publicUrl).toString()} />;
  return (
    <div className="max-w-xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          Join room <span className="font-mono">{view.code}</span>
        </h1>
        <p className="text-muted">
          {view.members.length} {view.members.length === 1 ? 'player' : 'players'} here: {view.members.map((m) => m.name).join(', ')}.
          {view.phase !== 'lobby' && view.phase !== 'finished' && ' A match is under way. You’ll play in the next one.'}
        </p>
        <Message error={error ? (ERROR[error] ?? 'Something went wrong. Please try again.') : undefined} />
      </header>
      <form method="post" action={`/api/rooms/${view.code}/join`} className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-sm text-muted">Your name in the room</span>
          <input
            name="name"
            required
            minLength={3}
            maxLength={24}
            pattern="[A-Za-z0-9][A-Za-z0-9_\-]*"
            defaultValue={name}
            className="rounded border border-line bg-panel px-3 py-1.5 font-mono"
          />
        </label>
        <button type="submit" className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink">
          Join
        </button>
      </form>
      <p className="text-sm text-muted">
        No account needed. Your name, your results and the keys you type in this room are kept until a week after its last game.
      </p>
    </div>
  );
}
