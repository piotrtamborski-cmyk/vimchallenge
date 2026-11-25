/**
 * A judge worker: one engine (jsdom + CodeMirror + vim-core) in its own thread, judging one run at
 * a time. vim-core state is global per thread, so runs in one worker never overlap, and every run
 * starts from a fresh session (registers, undo history, search and macros reset).
 */
import { parentPort } from 'node:worker_threads';
import { judgeRun } from './judge-run.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

const port = parentPort!;

// Load the engine before taking jobs, so the first run is not slowed by the start-up.
await judgeRun({ initial: { lines: ['warm up'], cursor: [1, 1] }, expected: {}, keys: ['w', 'x', 'u'] }, 100);

port.on('message', async (msg: ToWorker) => {
  const t0 = performance.now();
  const result = await judgeRun(msg.job, msg.maxTextLength);
  port.postMessage({ type: 'result', id: msg.id, result, ms: performance.now() - t0 } satisfies FromWorker);
});
port.postMessage({ type: 'ready' } satisfies FromWorker);
