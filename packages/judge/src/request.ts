/** The body of POST /v1/judge, checked before anything is replayed. */
import { isToken } from '@vimchallenge/engine';

export interface JudgeRequest {
  /** Task id, e.g. `undo-a-change`. */
  task: string;
  /** Task version the run was played on. */
  version: number;
  /** Key log in engine tokens, as the browser editor records it (`x`, `<Esc>`, `<C-v>`). */
  keys: string[];
}

/** The request, or a message saying what is wrong with it. */
export function parseRequest(body: unknown): JudgeRequest | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'expected a JSON object';
  const { task, version, keys } = body as Record<string, unknown>;
  if (typeof task !== 'string' || !/^[a-z0-9-]{1,64}$/.test(task)) return '`task` must be a task id';
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return '`version` must be a positive integer';
  if (!Array.isArray(keys)) return '`keys` must be an array of key tokens';
  const bad = keys.findIndex((k) => typeof k !== 'string' || !isToken(k));
  if (bad >= 0) return `\`keys[${bad}]\` is not a key token`;
  return { task, version, keys: keys as string[] };
}
