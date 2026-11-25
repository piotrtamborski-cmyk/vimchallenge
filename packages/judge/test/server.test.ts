import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JudgePool } from '../src/pool.ts';
import { createJudgeServer } from '../src/server.ts';

describe('judge HTTP API', { timeout: 30_000 }, () => {
  const pool = new JudgePool({ workers: 1, limits: { maxKeys: 100 } });
  const server = createJudgeServer(pool, { maxBodyBytes: 4096 });
  let base = '';

  beforeAll(async () => {
    await pool.ready();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.close();
    await pool.close();
  });

  const post = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
    fetch(`${base}/v1/judge`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('passes a correct run', async () => {
    const res = await post({ task: 'undo-a-change', version: 1, keys: ['x', 'u'] });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({ verdict: 'passed', failures: [], task: 'undo-a-change', version: 1, keys: 2, judge: { version: 1 } });
  });

  it('fails a run that skips a required step and says which', async () => {
    const res = await post({ task: 'undo-a-change', version: 1, keys: ['x', 'a', '!', '<Esc>'] });
    const body = await res.json();
    expect(body.verdict).toBe('failed');
    expect(body.failures).toEqual([expect.objectContaining({ field: 'steps', want: expect.objectContaining({ change: 'undo' }) })]);
  });

  it('reports a run over the limits as rejected', async () => {
    const res = await post({ task: 'undo-a-change', version: 1, keys: Array(101).fill('l') });
    expect(await res.json()).toMatchObject({ verdict: 'rejected', reason: 'too-many-keys' });
  });

  it('refuses requests it cannot judge', async () => {
    expect((await post({ task: 'no-such-task', version: 1, keys: [] })).status).toBe(404);
    const changed = await post({ task: 'undo-a-change', version: 2, keys: [] });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ version: 1 });
    expect((await post({ task: 'undo-a-change', version: 1, keys: ['<esc>'] })).status).toBe(400);
    expect((await post({ task: 'undo-a-change', version: 1, keys: ['xu'] })).status).toBe(400);
    expect((await post({ task: 'undo-a-change', version: 1 })).status).toBe(400);
    expect((await post('{"task":')).status).toBe(400);
    expect((await post({ task: 'undo-a-change', version: 1, keys: ['x'] }, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post({ task: 'undo-a-change', version: 1, keys: Array(2000).fill('x') })).status).toBe(413);
    expect((await fetch(`${base}/v1/judge`)).status).toBe(405);
    expect((await fetch(`${base}/elsewhere`)).status).toBe(404);
  });

  it('reports its workers', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(await res.json()).toMatchObject({ ok: true, workers: 1, ready: 1 });
  });
});
