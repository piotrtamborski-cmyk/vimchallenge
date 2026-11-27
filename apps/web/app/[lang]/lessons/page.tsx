import { lessonById, lessons } from '@vimchallenge/tasks';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeText } from '@/components/Prompt';
import { i18nFor, pageI18n } from '@/lib/i18n/server';

type Props = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: i18nFor((await params).lang).m.lessons.title };
}

export default async function LessonsPage({ params }: Props) {
  const { m, t, href, list } = await pageI18n(params);
  const sections = [...new Set(lessons.map((l) => l.section))];
  return (
    <div className="space-y-8">
      <div className="max-w-2xl space-y-2">
        <h1 className="text-2xl font-semibold">{m.lessons.title}</h1>
        <p className="text-muted">{m.lessons.intro}</p>
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
                  <Link href={href(`/lessons/${l.id}`)} className="flex h-full flex-col gap-1 rounded-lg border border-line bg-panel p-4 hover:border-accent">
                    <span className="font-semibold">
                      <span className="font-mono text-muted">{String(lessons.indexOf(l) + 1).padStart(2, '0')}</span> {l.title}
                    </span>
                    <span className="text-sm text-muted">
                      <CodeText text={l.summary} />
                    </span>
                    <span className="mt-auto pt-2 text-sm text-muted">
                      {t(m.lessons.exercises, { n: l.tasks.length })}
                      {l.requires.length > 0 && <> · {t(m.lessons.after, { lessons: list(l.requires.map((r) => lessonById(r)?.title ?? r)) })}</>}
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
