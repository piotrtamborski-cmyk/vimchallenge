/**
 * The judge on published tasks: every solution passes, and for tasks with step goals a key log
 * that reaches the same final text without the required steps fails.
 */
import { checkGoals, parseKeys, type GoalFailure } from '@vimchallenge/engine';
import { replay } from '@vimchallenge/engine/headless';
import { describe, expect, it } from 'vitest';
import { taskById, tasks } from '../src/index.ts';

async function judge(id: string, keys: string): Promise<GoalFailure[]> {
  const task = taskById(id)!;
  return checkGoals(await replay(task.initial, parseKeys(keys)), task.expected);
}

const missingStep = (failures: GoalFailure[]) =>
  failures.map((f) => (f.field === 'steps' ? (f.want as { label: string }).label : `${f.field} failed`));

describe('published solutions', () => {
  it.each(tasks.map((t) => [t.id, t.keys]))('%s: %s passes', async (id, keys) => {
    expect(await judge(id, keys)).toEqual([]);
  });
});

describe('undo-a-change', () => {
  it('accepts other ways to undo the deletion', async () => {
    expect(await judge('undo-a-change', 'xxuu')).toEqual([]);
    expect(await judge('undo-a-change', 'x:u<CR>')).toEqual([]);
  });
  it('rejects typing the `!` again', async () => {
    expect(missingStep(await judge('undo-a-change', 'xa!<Esc>'))).toEqual(['Undo the deletion to get the `!` back.']);
  });
  it('rejects undoing some other edit', async () => {
    expect(missingStep(await judge('undo-a-change', 'ix<Esc>u'))).toEqual(['Delete the `!`.']);
  });
  it('rejects doing nothing, though the text already matches', async () => {
    expect(missingStep(await judge('undo-a-change', ''))).toEqual(['Delete the `!`.']);
  });
});

describe('visit-the-end-first', () => {
  const step = 'Move to the last character of the document before your first edit.';
  it('accepts another way to the end', async () => {
    expect(await judge('visit-the-end-first', 'GA<Esc>bbciwnew<Esc>')).toEqual([]);
  });
  it('rejects the same text reached without visiting the end', async () => {
    expect(missingStep(await judge('visit-the-end-first', 'jwwwciwnew<Esc>'))).toEqual([step]);
  });
  it('rejects visiting the end only after the edit', async () => {
    expect(missingStep(await judge('visit-the-end-first', 'jwwwciwnew<Esc>G$'))).toEqual([step]);
  });
});
