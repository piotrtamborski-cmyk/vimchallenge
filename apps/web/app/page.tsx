import { lessons, lessonsForTask, tasks, textCount } from '@vimchallenge/tasks';
import Link from 'next/link';
import { TaskPlayer } from '@/components/TaskPlayer';

export default function Home() {
  const first = tasks[0]!;
  const second = tasks[1];
  const firstLesson = lessonsForTask(first.id)[0];
  return (
    <div className="space-y-10">
      <div className="max-w-2xl space-y-3">
        <p className="text-3xl font-semibold leading-tight">Can you fix this text in Vim?</p>
        <p className="text-lg text-muted">
          Learn a Vim technique, practise it in a real editor in your browser, then compete on the same tasks.
          No account needed to play.
        </p>
      </div>
      <TaskPlayer
        task={first}
        text={{ n: 1, count: textCount(first), nextHref: `/tasks/${first.id}?text=2` }}
        next={second ? { href: `/tasks/${second.id}`, label: 'Next task →' } : undefined}
        lesson={firstLesson ? { title: firstLesson.title, href: `/lessons/${firstLesson.id}` } : undefined}
        autofocus={false}
      />
      <p className="flex flex-wrap gap-x-6 gap-y-2">
        <Link href={`/lessons/${lessons[0]!.id}`} className="underline">
          New to Vim? Start with the first lesson →
        </Link>
        <Link href="/lessons" className="underline">
          All {lessons.length} lessons
        </Link>
        <Link href="/tasks" className="underline">
          All {tasks.length} tasks
        </Link>
      </p>
    </div>
  );
}
