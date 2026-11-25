import { lessonById, nextLesson, taskById } from '@vimchallenge/tasks';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CodeText, Prompt } from '@/components/Prompt';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const lesson = lessonById((await params).id);
  return { title: lesson?.title ?? 'Lesson not found', description: lesson?.summary };
}

export default async function LessonPage({ params }: Props) {
  const lesson = lessonById((await params).id);
  if (!lesson) notFound();
  const next = nextLesson(lesson.id);
  const first = lesson.tasks[0]!;
  return (
    <article className="max-w-3xl space-y-8">
      <header className="space-y-2">
        <p className="text-sm text-muted">
          <Link href="/lessons" className="underline">
            Lessons
          </Link>{' '}
          · {lesson.section}
        </p>
        <h1 className="text-2xl font-semibold">{lesson.title}</h1>
        <p className="text-lg text-muted">{lesson.summary}</p>
        {lesson.requires.length > 0 && (
          <p className="text-sm text-muted">
            Builds on{' '}
            {lesson.requires.map((r, i) => (
              <span key={r}>
                {i > 0 && ', '}
                <Link href={`/lessons/${r}`} className="underline">
                  {lessonById(r)?.title}
                </Link>
              </span>
            ))}
            .
          </p>
        )}
      </header>

      <div className="space-y-4 text-lg leading-relaxed">
        {lesson.body.map((p) => (
          <Prompt key={p} text={p} />
        ))}
      </div>

      <section aria-labelledby="keys" className="space-y-3">
        <h2 id="keys" className="text-lg font-semibold">
          Keys
        </h2>
        <table className="w-full border-collapse text-left">
          <tbody>
            {lesson.keys.map((k) => (
              <tr key={k.keys} className="border-t border-line">
                <th scope="row" className="w-40 py-2 pr-4 align-top font-normal">
                  <kbd className="rounded bg-line/50 px-1.5 py-0.5 font-mono">{k.keys}</kbd>
                </th>
                <td className="py-2">
                  <CodeText text={k.does} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="practice" className="space-y-3">
        <h2 id="practice" className="text-lg font-semibold">
          Practice
        </h2>
        <ol className="list-inside list-decimal space-y-1">
          {lesson.tasks.map((id) => (
            <li key={id}>
              <Link href={`/lessons/${lesson.id}/${id}`} className="underline">
                {taskById(id)?.title}
              </Link>
            </li>
          ))}
        </ol>
        <p className="flex flex-wrap gap-4 pt-2">
          <Link href={`/lessons/${lesson.id}/${first}`} className="rounded bg-accent px-4 py-2 font-semibold text-accent-ink">
            Start practising
          </Link>
          {next && (
            <Link href={`/lessons/${next.id}`} className="py-2 underline">
              Next lesson: {next.title} →
            </Link>
          )}
        </p>
      </section>
    </article>
  );
}
