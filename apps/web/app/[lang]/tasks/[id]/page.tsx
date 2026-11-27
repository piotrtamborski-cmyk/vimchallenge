import { nextTask, onText, taskById, textCount } from '@vimchallenge/tasks';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TaskPlayer } from '@/components/TaskPlayer';
import { taskProgress } from '@/lib/auth/session';
import { i18nFor } from '@/lib/i18n/server';
import { taskLessons } from '@/lib/lesson-links';

type Props = { params: Promise<{ lang: string; id: string }>; searchParams: Promise<{ text?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, id } = await params;
  return { title: taskById(id)?.title ?? i18nFor(lang).m.tasks.notFound };
}

export default async function TaskPage({ params, searchParams }: Props) {
  const { lang, id } = await params;
  const { m, href } = i18nFor(lang);
  const n = Number((await searchParams).text ?? 1);
  const base = taskById(id);
  const task = base && onText(base, n);
  if (!base || !task) notFound();
  const count = textCount(base);
  const next = nextTask(id);
  return (
    <TaskPlayer
      key={`${task.id}:${n}`}
      task={task}
      text={{ n, count, nextHref: href(`/tasks/${id}?text=${(n % count) + 1}`) }}
      next={next ? { href: href(`/tasks/${next.id}`), label: m.tasks.next } : undefined}
      lessons={taskLessons(id, undefined, href)}
      progress={await taskProgress(id)}
    />
  );
}
