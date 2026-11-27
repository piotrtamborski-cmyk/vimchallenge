import { lessons, tasks, textCount } from '@vimchallenge/tasks';
import Link from 'next/link';
import { TaskPlayer } from '@/components/TaskPlayer';
import { pageI18n } from '@/lib/i18n/server';
import { taskLessons } from '@/lib/lesson-links';

type Props = { params: Promise<{ lang: string }> };

export default async function Home({ params }: Props) {
  const { m, t, href } = await pageI18n(params);
  const first = tasks[0]!;
  const second = tasks[1];
  return (
    <div className="space-y-10">
      <div className="max-w-2xl space-y-3">
        <p className="text-3xl font-semibold leading-tight">{m.home.question}</p>
        <p className="text-lg text-muted">{m.home.intro}</p>
      </div>
      <TaskPlayer
        task={first}
        text={{ n: 1, count: textCount(first), nextHref: href(`/tasks/${first.id}?text=2`) }}
        next={second ? { href: href(`/tasks/${second.id}`), label: m.home.nextTask } : undefined}
        lessons={taskLessons(first.id, undefined, href)}
        autofocus={false}
      />
      <p className="flex flex-wrap gap-x-6 gap-y-2">
        <Link href={href(`/lessons/${lessons[0]!.id}`)} className="underline">
          {m.home.firstLesson}
        </Link>
        <Link href={href('/lessons')} className="underline">
          {t(m.home.allLessons, { n: lessons.length })}
        </Link>
        <Link href={href('/tasks')} className="underline">
          {t(m.home.allTasks, { n: tasks.length })}
        </Link>
        <Link href={href('/daily')} className="underline">
          {m.home.daily}
        </Link>
        <Link href={href('/rooms')} className="underline">
          {m.home.rooms}
        </Link>
      </p>
    </div>
  );
}
