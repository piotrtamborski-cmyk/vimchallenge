/** Which lesson explains an unmet goal. Runs in the browser, so it gets the lessons from the page. */
import type { GoalFailure, StepGoal } from '@vimchallenge/engine';
import type { Topic } from '@vimchallenge/tasks';

export interface LessonLink {
  title: string;
  href: string;
}

export interface TaskLessons {
  /** The lesson that teaches the task. */
  task?: LessonLink;
  /** Lessons for goals that are a technique of their own (mode, selection, register, undo). */
  topics: Partial<Record<Topic, LessonLink>>;
}

/** The kind of technique an unmet goal is about, when it has a lesson of its own. */
export function topicOf(f: GoalFailure): Topic | undefined {
  if (f.field === 'mode') return 'mode';
  if (f.field === 'visual') return 'visual';
  if (f.field.startsWith('register ')) return 'register';
  const change = f.field === 'steps' ? (f.want as StepGoal).change : undefined;
  return change === 'undo' || change === 'redo' ? 'undo' : undefined;
}

/** The lessons that explain the unmet goals, each once, the task's own first. */
export function lessonsFor(failures: readonly GoalFailure[], lessons?: TaskLessons): LessonLink[] {
  const found = failures.map((f) => {
    const topic = topicOf(f);
    return (topic && lessons?.topics[topic]) || lessons?.task;
  });
  const ordered = [lessons?.task, ...found].filter((l): l is LessonLink => !!l && found.includes(l));
  return ordered.filter((l, i) => ordered.findIndex((o) => o.href === l.href) === i);
}
