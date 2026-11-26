import { redirect } from 'next/navigation';

type Props = { searchParams: Promise<{ code?: string }> };

/** The "join with a code" form: accepts a code or a whole invite link. */
export default async function GoToRoom({ searchParams }: Props) {
  const raw = ((await searchParams).code ?? '').trim().toLowerCase();
  const code = raw.split('/').filter(Boolean).at(-1)?.replace(/[^a-z0-9]/g, '') ?? '';
  redirect(code ? `/rooms/${code}` : '/rooms');
}
