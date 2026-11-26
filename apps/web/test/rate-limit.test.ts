import { describe, expect, it } from 'vitest';
import { POST } from '../app/api/judge/route.ts';
import { clientKey, RateLimiter } from '../lib/rate-limit.ts';

describe('RateLimiter', () => {
  const clock = () => {
    let t = 0;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it('allows a burst, then one request per interval', () => {
    const c = clock();
    const limiter = new RateLimiter({ perMinute: 30, burst: 3, maxClients: 10, now: c.now });
    expect([1, 2, 3].map(() => limiter.take('a').allowed)).toEqual([true, true, true]);
    expect(limiter.take('a')).toEqual({ allowed: false, retryAfterSeconds: 2 });
    c.advance(1999);
    expect(limiter.take('a').allowed).toBe(false);
    c.advance(1);
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
  });

  it('refills up to the burst only', () => {
    const c = clock();
    const limiter = new RateLimiter({ perMinute: 60, burst: 2, maxClients: 10, now: c.now });
    limiter.take('a');
    c.advance(3_600_000);
    expect([1, 2, 3].map(() => limiter.take('a').allowed)).toEqual([true, true, false]);
  });

  it('keeps clients apart and forgets the least recently seen', () => {
    const c = clock();
    const limiter = new RateLimiter({ perMinute: 1, burst: 1, maxClients: 2, now: c.now });
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('b').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false); // a is now the most recent
    expect(limiter.take('c').allowed).toBe(true); // b is forgotten
    expect(limiter.size).toBe(2);
    expect(limiter.take('b').allowed).toBe(true); // b starts over; a is forgotten now
    expect(limiter.take('c').allowed).toBe(false); // c is still remembered, with no tokens left
  });
});

describe('clientKey', () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it('takes the address the nearest proxy saw', () => {
    expect(clientKey(h({ 'x-forwarded-for': '198.51.100.9, 203.0.113.5' }))).toBe('203.0.113.5');
    expect(clientKey(h({ 'x-forwarded-for': '::ffff:203.0.113.5' }))).toBe('203.0.113.5');
    expect(clientKey(h({}))).toBe('unknown');
  });
  it('uses the configured header and ignores x-forwarded-for then', () => {
    const headers = h({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1' });
    expect(clientKey(headers, 'cf-connecting-ip')).toBe('203.0.113.7');
    expect(clientKey(h({ 'x-forwarded-for': '198.51.100.1' }), 'cf-connecting-ip')).toBe('unknown');
  });
  it('groups IPv6 addresses by /64', () => {
    expect(clientKey(h({ 'x-forwarded-for': '2001:db8:1:2:aaaa::1' }))).toBe('2001:db8:1:2::/64');
    expect(clientKey(h({ 'x-forwarded-for': '2001:db8:1:2:ffff:ffff:ffff:ffff' }))).toBe('2001:db8:1:2::/64');
    expect(clientKey(h({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8:0:0::/64');
    expect(clientKey(h({ 'x-forwarded-for': '::1' }))).toBe('0:0:0:0::/64');
  });
});

describe('POST /api/judge rate limit', () => {
  it('answers 429 with Retry-After after a burst of 20 from one address', async () => {
    // A content type the route refuses: every request is counted before anything else is done.
    const send = (ip: string) =>
      POST(new Request('http://localhost/api/judge', { method: 'POST', headers: { 'content-type': 'text/plain', 'x-forwarded-for': ip }, body: 'x' }));
    const statuses = [];
    for (let i = 0; i < 21; i++) statuses.push((await send('203.0.113.200')).status);
    expect(statuses.slice(0, 20).every((s) => s === 415)).toBe(true);
    const limited = await send('203.0.113.200');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await send('203.0.113.201')).status).toBe(415);
  });
});

describe('readBody', async () => {
  const { readBody } = await import('../lib/body.ts');
  const streamed = (parts: string[]) =>
    new Request('http://localhost/', {
      method: 'POST',
      body: new ReadableStream({
        start(c) {
          for (const p of parts) c.enqueue(new TextEncoder().encode(p));
          c.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);

  it('reads bodies up to the limit, with or without a length', async () => {
    expect(await readBody(new Request('http://localhost/', { method: 'POST', body: 'a=1' }), 10)).toBe('a=1');
    expect(await readBody(streamed(['a=', 'ż']), 10)).toBe('a=ż');
    expect(await readBody(new Request('http://localhost/'), 10)).toBe('');
  });

  it('stops at the limit', async () => {
    expect(await readBody(new Request('http://localhost/', { method: 'POST', body: 'x'.repeat(11) }), 10)).toBeUndefined();
    expect(await readBody(streamed(['x'.repeat(6), 'x'.repeat(6)]), 10)).toBeUndefined();
  });
});
