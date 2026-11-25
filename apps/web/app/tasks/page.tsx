import { tasks } from '@vimchallenge/tasks';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Tasks' };

export default function TasksPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Tasks</h1>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tasks.map((t, i) => (
          <li key={t.id}>
            <Link href={`/tasks/${t.id}`} className="flex h-full gap-3 rounded-lg border border-line bg-panel p-4 hover:border-accent">
              <span className="font-mono text-muted">{String(i + 1).padStart(2, '0')}</span>
              <span className="font-semibold">{t.title}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
