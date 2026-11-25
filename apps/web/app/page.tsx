import { tasks } from '@vimchallenge/tasks';
import Link from 'next/link';
import { TaskPlayer } from '@/components/TaskPlayer';

export default function Home() {
  const first = tasks[0]!;
  const second = tasks[1];
  return (
    <div className="space-y-10">
      <div className="max-w-2xl space-y-3">
        <p className="text-3xl font-semibold leading-tight">Can you fix this text in Vim?</p>
        <p className="text-lg text-muted">
          Learn a Vim technique, practise it in a real editor in your browser, then compete on the same tasks.
          No account needed to play.
        </p>
      </div>
      <TaskPlayer task={first} nextHref={second ? `/tasks/${second.id}` : undefined} autofocus={false} />
      <p>
        <Link href="/tasks" className="underline">
          All {tasks.length} tasks →
        </Link>
      </p>
    </div>
  );
}
