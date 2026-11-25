import { nextTask, taskById, tasks } from '@vimchallenge/tasks';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TaskPlayer } from '@/components/TaskPlayer';

type Props = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return tasks.map((t) => ({ id: t.id }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const task = taskById((await params).id);
  return { title: task?.title ?? 'Task not found' };
}

export default async function TaskPage({ params }: Props) {
  const { id } = await params;
  const task = taskById(id);
  if (!task) notFound();
  const next = nextTask(id);
  return <TaskPlayer key={task.id} task={task} nextHref={next ? `/tasks/${next.id}` : undefined} />;
}
