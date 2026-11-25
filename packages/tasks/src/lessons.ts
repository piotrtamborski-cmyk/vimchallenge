/** Lessons: a technique explained in a few paragraphs, its keys, and published tasks to practise it. */
import data from '../lessons.json' with { type: 'json' };

export interface Lesson {
  /** Slug, used in /lessons/{id}. */
  id: string;
  /** Lesson in the planning programme (L01…). */
  plan: string;
  section: string;
  title: string;
  summary: string;
  /** Lessons to take first. */
  requires: string[];
  /** Paragraphs; Markdown-lite: `code` spans only. */
  body: string[];
  /** Keys the lesson teaches, in key notation, with what they do. */
  keys: { keys: string; does: string }[];
  /** Task ids, in the order to practise them. */
  tasks: string[];
}

export const lessons: readonly Lesson[] = data as Lesson[];

export function lessonById(id: string): Lesson | undefined {
  return lessons.find((l) => l.id === id);
}

/** Lessons that practise a task, in programme order. */
export function lessonsForTask(taskId: string): Lesson[] {
  return lessons.filter((l) => l.tasks.includes(taskId));
}

/** The lesson after `id` in the programme, if any. */
export function nextLesson(id: string): Lesson | undefined {
  const i = lessons.findIndex((l) => l.id === id);
  return i < 0 ? undefined : lessons[i + 1];
}
