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
  const tasks = JSON.parse(await readFile(`${repoRoot}packages/tasks/tasks.json`, 'utf8')) as Omit<Case, 'source'>[];
  for (const t of tasks) all.push({ ...t, source: 'tasks', mvp: true });
  return all.filter((c) => !filter.size || filter.has(c.id));
}
