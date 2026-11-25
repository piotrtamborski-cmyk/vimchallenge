/** Published tasks. Each one is replayed in reference Vim by the conformance harness (CI). */
import type { Task } from '@vimchallenge/engine';
import data from '../tasks.json' with { type: 'json' };

export interface BankTask extends Task {
  /** Card in the planning bank this task was written from. */
  plan?: string;
}

export const tasks: readonly BankTask[] = data as BankTask[];

export function taskById(id: string): BankTask | undefined {
  return tasks.find((t) => t.id === id);
}

/** Texts a task can be practised on: the task itself and its variants. */
export const textCount = (task: BankTask): number => 1 + (task.variants?.length ?? 0);

/**
 * The task on its text number `n` (1-based; 1 is the task as published), or undefined when it has no
 * such text. Everything the judge needs (prompt, keys, start, goals) comes from the variant.
 */
export function onText(task: BankTask, n: number): BankTask | undefined {
  if (n === 1) return task;
  const v = Number.isInteger(n) && n > 1 ? task.variants?.[n - 2] : undefined;
  return v && { ...task, ...v };
}

/** The task after `id` in the training order, if any. */
export function nextTask(id: string): BankTask | undefined {
  const i = tasks.findIndex((t) => t.id === id);
  return i < 0 ? undefined : tasks[i + 1];
}

export { lessonById, lessons, lessonsForTask, nextLesson, type Lesson } from './lessons.ts';
export { validateLessons, validateTasks } from './validate.ts';
