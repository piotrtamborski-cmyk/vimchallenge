import { tasks } from '@vimchallenge/tasks';
import type { Metadata } from 'next';
import Link from 'next/link';
import { solvedTasks } from '@/lib/auth/session';
import { i18nFor, pageI18n } from '@/lib/i18n/server';

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: i18nFor((await params).lang).m.tasks.title };
}

export default async function TasksPage({ params }: Props) {
  const { m, t, href } = await pageI18n(params);
  const solved = await solvedTasks();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{m.tasks.title}</h1>
      {solved.size > 0 && <p className="text-muted">{t(m.tasks.solvedOf, { solved: solved.size, total: tasks.length })}</p>}
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tasks.map((task, i) => (
          <li key={task.id}>
            <Link href={href(`/tasks/${task.id}`)} className="flex h-full gap-3 rounded-lg border border-line bg-panel p-4 hover:border-accent">
              <span className="font-mono text-muted">{String(i + 1).padStart(2, '0')}</span>
              <span className="font-semibold">{task.title}</span>
              {solved.has(task.id) && (
                <span className="ml-auto text-good" title={m.tasks.solved}>
                  ✓<span className="sr-only"> {m.tasks.solved}</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
