/** Published tasks. Each one is replayed in reference Vim by the conformance harness (CI). */
import type { Task } from '@vimchallenge/engine';
import data from '../tasks.json' with { type: 'json' };

export interface BankTask extends Task {
  /** Card in the planning bank this task was written from. */
  plan?: string;
  /**
   * Difficulty, 1 to 5; sets the points of a solve in contests (`LEVEL_BASE`). Cards V001–V016 of
   * the planning bank are level 1, V017–V032 level 2, and so on.
   */
  level: number;
}

/** Points for a solve at each level, before the time bonus (up to a quarter more). */
export const LEVEL_BASE: Readonly<Record<number, number>> = { 1: 100, 2: 160, 3: 240, 4: 360, 5: 520 };

/** The level of a planning card, from its number: 16 cards per level. */
export const planLevel = (plan: string): number => Math.ceil(Number(plan.slice(1)) / 16);

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

export { lessonById, lessons, lessonsForTask, nextLesson, TOPIC_LESSONS, type Lesson, type Topic } from './lessons.ts';
export { validateLessons, validateTasks } from './validate.ts';
