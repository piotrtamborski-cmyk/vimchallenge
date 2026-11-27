import { lessonById, nextLesson, onText, taskById, textCount } from '@vimchallenge/tasks';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TaskPlayer } from '@/components/TaskPlayer';
import { taskProgress } from '@/lib/auth/session';
import { i18nFor } from '@/lib/i18n/server';
import { taskLessons } from '@/lib/lesson-links';

type Props = { params: Promise<{ lang: string; id: string; task: string }>; searchParams: Promise<{ text?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang, id, task } = await params;
  const lesson = lessonById(id);
  const t = taskById(task);
  return { title: lesson && t ? `${t.title} · ${lesson.title}` : i18nFor(lang).m.exercise.notFound };
}

/** A task practised inside a lesson: "Next" leads through the lesson's exercises, then to the next lesson. */
export default async function ExercisePage({ params, searchParams }: Props) {
  const { lang, id, task: taskId } = await params;
  const { m, t, href } = i18nFor(lang);
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
    ? { href: href(`/lessons/${lesson.id}/${nextId}`), label: m.exercise.next }
    : after
      ? { href: href(`/lessons/${after.id}`), label: t(m.exercise.lessonDone, { title: after.title }) }
      : { href: href('/lessons'), label: m.exercise.allDone };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        <Link href={href(`/lessons/${lesson.id}`)} className="underline">
          {lesson.title}
        </Link>{' '}
        · {t(m.exercise.position, { n: index + 1, count: lesson.tasks.length })}
      </p>
      <TaskPlayer
        key={`${task.id}:${n}`}
        task={task}
        text={{ n, count, nextHref: href(`/lessons/${lesson.id}/${taskId}?text=${(n % count) + 1}`) }}
        next={next}
        lessons={taskLessons(taskId, lesson.id, href)}
        progress={await taskProgress(taskId)}
      />
    </div>
  );
}
