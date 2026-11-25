/**
 * Load check: `npm run -w @vimchallenge/judge bench [requests] [concurrency]` sends published
 * solutions to a local judge server and prints latency percentiles (plan target: p95 ≤ 500 ms
 * from a complete submission to the verdict).
 */
import type { AddressInfo } from 'node:net';
import { parseKeys } from '@vimchallenge/engine';
import { tasks } from '@vimchallenge/tasks';
import { JudgePool } from './pool.ts';
import { createJudgeServer } from './server.ts';

const total = Number(process.argv[2] ?? 400);
const concurrency = Number(process.argv[3] ?? 8);

const pool = new JudgePool();
await pool.ready();
const server = createJudgeServer(pool);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/judge`;

const latencies: number[] = [];
const judgeMs: number[] = [];
let sent = 0;
let failed = 0;
async function client() {
  while (sent < total) {
    const task = tasks[sent++ % tasks.length]!;
    const t0 = performance.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ task: task.id, version: task.version, keys: parseKeys(task.keys) }),
    });
    const body = (await res.json()) as { verdict?: string; timing?: { judgeMs: number } };
    latencies.push(performance.now() - t0);
    if (body.timing) judgeMs.push(body.timing.judgeMs);
    if (body.verdict !== 'passed') failed++;
  }
}
const t0 = performance.now();
await Promise.all(Array.from({ length: concurrency }, client));
const seconds = (performance.now() - t0) / 1000;

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((xs.length * p) / 100))]!.toFixed(0);
console.log(
  `${total} runs, ${concurrency} at a time, ${pool.options.workers} workers: ${(total / seconds).toFixed(0)} runs/s, ` +
    `latency p50 ${pct(latencies, 50)} ms, p95 ${pct(latencies, 95)} ms, max ${pct(latencies, 100)} ms; ` +
    `replay p50 ${pct(judgeMs, 50)} ms, p95 ${pct(judgeMs, 95)} ms; not passed: ${failed}`,
);
server.close();
await pool.close();
