/** Every case the harnesses run: probes and plan cards (cases/) plus the published tasks. */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Expected, InitialState } from '@vimchallenge/engine';

export interface Case {
  id: string;
  source: string;
  mvp?: boolean;
  title?: string;
  prompt?: string;
  keys: string;
  initial: InitialState;
  expected: Expected;
  semanticNotes?: string[];
}

export const root = fileURLToPath(new URL('..', import.meta.url));
export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export async function loadCases(filter: Set<string> = new Set()): Promise<Case[]> {
  const dir = `${root}cases/`;
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const all: Case[] = [];
  for (const f of files) all.push(...(JSON.parse(await readFile(dir + f, 'utf8')) as Case[]));
  // Published tasks (packages/tasks) must pass in Vim and in the engine like every other case.
  // Each text of a task is its own case: `undo-a-change` is text 1, `undo-a-change@2` the first variant.
  const tasks = JSON.parse(await readFile(`${repoRoot}packages/tasks/tasks.json`, 'utf8')) as (Omit<Case, 'source'> & {
    variants?: Pick<Case, 'prompt' | 'keys' | 'initial' | 'expected'>[];
  })[];
  for (const { variants, ...t } of tasks) {
    all.push({ ...t, source: 'tasks', mvp: true });
    for (const [i, v] of (variants ?? []).entries()) all.push({ ...t, ...v, id: `${t.id}@${i + 2}`, source: 'tasks', mvp: true });
  }
  return all.filter((c) => !filter.size || filter.has(c.id));
}
