import type { Metadata } from 'next';
import Link from 'next/link';
import { Message } from '@/components/Messages';
import { Room } from '@/components/Room';
import { authConfig } from '@/lib/auth/context';
import { i18nFor } from '@/lib/i18n/server';
import { roomsContext } from '@/lib/rooms/context';
import { roomError } from '@/lib/rooms/messages';
import { pagePlayer } from '@/lib/rooms/page';

type Props = { params: Promise<{ lang: string; code: string }>; searchParams: Promise<{ error?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: i18nFor((await params).lang).m.rooms.roomTitle };
}

export default async function RoomPage({ params, searchParams }: Props) {
  const { lang, code } = await params;
  const i = i18nFor(lang);
  const { m, t, href } = i;
  const r = m.rooms;
  const { error } = await searchParams;
  const { player, name } = await pagePlayer();
  const view = roomsContext().view(code, player);
  if (!view)
    return (
      <div className="max-w-xl space-y-4">
        <h1 className="text-2xl font-semibold">{r.noSuchTitle}</h1>
        <p>{r.noSuchBody}</p>
        <p>
          <Link href={href('/rooms')} className="underline">
            {r.startNew}
          </Link>
        </p>
      </div>
    );
  // The invitation has no language code: each friend gets the room in their own language.
  if (view.you) return <Room initial={view} invite={new URL(`/rooms/${view.code}`, authConfig().publicUrl).toString()} />;
  return (
    <div className="max-w-xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{i.rich(r.joinTitle, { code: <span className="font-mono">{view.code}</span> })}</h1>
        <p className="text-muted">
          {t(r.here, { n: view.members.length, names: i.list(view.members.map((member) => member.name)) })}
          {view.phase !== 'lobby' && view.phase !== 'finished' && ` ${r.underWay}`}
        </p>
        <Message error={error === 'rate' ? r.error.joinRate : roomError(i, error)} />
      </header>
      <form method="post" action={`/api/rooms/${view.code}/join`} className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="block text-sm text-muted">{r.yourName}</span>
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
          {r.joinButton}
        </button>
      </form>
      <p className="text-sm text-muted">{r.guestNote}</p>
    </div>
  );
}
