import { redirect } from 'next/navigation';
import { i18nFor } from '@/lib/i18n/server';

type Props = { params: Promise<{ lang: string }>; searchParams: Promise<{ code?: string }> };

/** The "join with a code" form: accepts a code or a whole invite link. */
export default async function GoToRoom({ params, searchParams }: Props) {
  const { href } = i18nFor((await params).lang);
  const raw = ((await searchParams).code ?? '').trim().toLowerCase();
  const code = raw.split('/').filter(Boolean).at(-1)?.replace(/[^a-z0-9]/g, '') ?? '';
  redirect(href(code ? `/rooms/${code}` : '/rooms'));
}
