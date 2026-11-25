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

/** The task after `id` in the training order, if any. */
export function nextTask(id: string): BankTask | undefined {
  const i = tasks.findIndex((t) => t.id === id);
  return i < 0 ? undefined : tasks[i + 1];
}
