import { lessonById, lessons } from '@vimchallenge/tasks';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Lessons' };

export default function LessonsPage() {
  const sections = [...new Set(lessons.map((l) => l.section))];
  return (
    <div className="space-y-8">
      <div className="max-w-2xl space-y-2">
        <h1 className="text-2xl font-semibold">Lessons</h1>
        <p className="text-muted">
          Each lesson explains one technique in a few paragraphs, then you practise it on short tasks. Take them in
          order, or start wherever you like.
        </p>
      </div>
      {sections.map((section) => (
        <section key={section} aria-labelledby={`section-${section}`} className="space-y-3">
          <h2 id={`section-${section}`} className="text-lg font-semibold">
            {section}
          </h2>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lessons
              .filter((l) => l.section === section)
              .map((l) => (
                <li key={l.id}>
                  <Link href={`/lessons/${l.id}`} className="flex h-full flex-col gap-1 rounded-lg border border-line bg-panel p-4 hover:border-accent">
                    <span className="font-semibold">
                      <span className="font-mono text-muted">{String(lessons.indexOf(l) + 1).padStart(2, '0')}</span> {l.title}
                    </span>
                    <span className="text-sm text-muted">{l.summary}</span>
                    <span className="mt-auto pt-2 text-sm text-muted">
                      {l.tasks.length} exercises
                      {l.requires.length > 0 && <> · after {l.requires.map((r) => lessonById(r)?.title).join(', ')}</>}
                    </span>
                  </Link>
                </li>
              ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
