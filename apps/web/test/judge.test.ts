/** The page's path to the judge: /api/judge forwards to a real judge service, and the page reads its answers. */
import type { AddressInfo } from 'node:net';
import { createJudgeServer, JudgePool } from '@vimchallenge/judge';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/judge/route.ts';
import { confirmOnServer } from '../lib/server-check.ts';

const request = (body: unknown, contentType = 'application/json') =>
  new Request('http://localhost/api/judge', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('POST /api/judge', { timeout: 30_000 }, () => {
  const pool = new JudgePool({ workers: 1 });
  const server = createJudgeServer(pool);

  beforeAll(async () => {
    await pool.ready();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.JUDGE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.close();
    await pool.close();
    delete process.env.JUDGE_URL;
  });

  it('returns the judge verdict', async () => {
    const res = await POST(request({ task: 'undo-a-change', version: 1, keys: ['x', 'u'] }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ verdict: 'passed', task: 'undo-a-change' });
  });

  it('passes on what the judge refuses', async () => {
    expect((await POST(request({ task: 'undo-a-change', version: 9, keys: [] }))).status).toBe(409);
    expect((await POST(request({ task: 'undo-a-change', version: 1, keys: ['xu'] }))).status).toBe(400);
  });

  it('refuses other content types and large bodies itself', async () => {
    expect((await POST(request('task=x', 'application/x-www-form-urlencoded'))).status).toBe(415);
    expect((await POST(request({ keys: Array(40_000).fill('x') }))).status).toBe(413);
  });

  it('answers 503 when the judge is not running', async () => {
    const saved = process.env.JUDGE_URL;
    process.env.JUDGE_URL = 'http://127.0.0.1:9';
    try {
      expect((await POST(request({ task: 'undo-a-change', version: 1, keys: [] }))).status).toBe(503);
    } finally {
      process.env.JUDGE_URL = saved;
    }
  });
});

describe('confirmOnServer', () => {
  afterEach(() => vi.unstubAllGlobals());
  const answer = (status: number, body: unknown) => vi.stubGlobal('fetch', async () => Response.json(body, { status }));
  const confirm = () => confirmOnServer({ id: 'undo-a-change', version: 1 }, ['x', 'u'], new AbortController().signal);

  it('reads every answer of the judge', async () => {
    answer(200, { verdict: 'passed' });
    expect(await confirm()).toEqual({ state: 'confirmed' });
    answer(200, { verdict: 'failed', failures: [] });
    expect((await confirm()).state).toBe('not-confirmed');
    answer(200, { verdict: 'rejected', reason: 'time' });
    expect(await confirm()).toEqual({ state: 'not-confirmed', detail: 'Replaying the run took the server too long.' });
    answer(409, { error: 'changed', version: 2 });
    expect((await confirm()).state).toBe('not-confirmed');
    answer(503, { error: 'busy' });
    expect((await confirm()).state).toBe('unavailable');
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network');
    });
    expect((await confirm()).state).toBe('unavailable');
  });
});
