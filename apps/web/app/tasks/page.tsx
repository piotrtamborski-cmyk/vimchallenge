import { tasks } from '@vimchallenge/tasks';
import type { Metadata } from 'next';
import Link from 'next/link';
import { solvedTasks } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Tasks' };

export default async function TasksPage() {
  const solved = await solvedTasks();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Tasks</h1>
      {solved.size > 0 && (
        <p className="text-muted">
          You have solved {solved.size} of {tasks.length}.
        </p>
      )}
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tasks.map((t, i) => (
          <li key={t.id}>
            <Link href={`/tasks/${t.id}`} className="flex h-full gap-3 rounded-lg border border-line bg-panel p-4 hover:border-accent">
              <span className="font-mono text-muted">{String(i + 1).padStart(2, '0')}</span>
              <span className="font-semibold">{t.title}</span>
              {solved.has(t.id) && (
                <span className="ml-auto text-good" title="Solved">
                  ✓<span className="sr-only"> solved</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
