import { lessonById, nextLesson, onText, taskById, textCount } from '@vimchallenge/tasks';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TaskPlayer } from '@/components/TaskPlayer';

type Props = { params: Promise<{ id: string; task: string }>; searchParams: Promise<{ text?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, task } = await params;
  const lesson = lessonById(id);
  const t = taskById(task);
  return { title: lesson && t ? `${t.title} · ${lesson.title}` : 'Exercise not found' };
}

/** A task practised inside a lesson: "Next" leads through the lesson's exercises, then to the next lesson. */
export default async function ExercisePage({ params, searchParams }: Props) {
  const { id, task: taskId } = await params;
  const n = Number((await searchParams).text ?? 1);
  const lesson = lessonById(id);
  const base = taskById(taskId);
  const task = base && onText(base, n);
  const index = lesson ? lesson.tasks.indexOf(taskId) : -1;
  if (!lesson || !base || !task || index < 0) notFound();
  const count = textCount(base);
  const nextId = lesson.tasks[index + 1];
  const after = nextLesson(lesson.id);
  const next = nextId
    ? { href: `/lessons/${lesson.id}/${nextId}`, label: 'Next exercise →' }
    : after
      ? { href: `/lessons/${after.id}`, label: `Lesson done. Next lesson: ${after.title} →` }
      : { href: '/lessons', label: 'All lessons done. Back to the lessons →' };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        <Link href={`/lessons/${lesson.id}`} className="underline">
          {lesson.title}
        </Link>{' '}
        · exercise {index + 1} of {lesson.tasks.length}
      </p>
      <TaskPlayer
        key={`${task.id}:${n}`}
        task={task}
        text={{ n, count, nextHref: `/lessons/${lesson.id}/${taskId}?text=${(n % count) + 1}` }}
        next={next}
        lesson={{ title: lesson.title, href: `/lessons/${lesson.id}` }}
      />
    </div>
  );
}
