import { nextTask, onText, taskById, textCount } from '@vimchallenge/tasks';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TaskPlayer } from '@/components/TaskPlayer';
import { taskProgress } from '@/lib/auth/session';
import { taskLessons } from '@/lib/lesson-links';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ text?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const task = taskById((await params).id);
  return { title: task?.title ?? 'Task not found' };
}

export default async function TaskPage({ params, searchParams }: Props) {
  const { id } = await params;
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
      text={{ n, count, nextHref: `/tasks/${id}?text=${(n % count) + 1}` }}
      next={next ? { href: `/tasks/${next.id}`, label: 'Next task →' } : undefined}
      lessons={taskLessons(id)}
      progress={await taskProgress(id)}
    />
  );
}
