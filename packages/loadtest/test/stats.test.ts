import { describe, expect, it } from 'vitest';
import { percentile, Recorder, sseMessages, summarize } from '../src/stats.ts';

describe('percentile', () => {
  it('takes the nearest rank', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 0.5)).toBe(50);
    expect(percentile(sorted, 0.95)).toBe(95);
    expect(percentile(sorted, 1)).toBe(100);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([], 0.95)).toBe(0);
  });
  it('summarizes unsorted samples', () => {
    expect(summarize([30, 10, 20])).toEqual({ count: 3, p50: 20, p95: 30, p99: 30, max: 30 });
  });
  it('records samples and counts by name', () => {
    const r = new Recorder();
    r.sample('check', 12);
    r.sample('check', 8);
    r.count('solved');
    r.count('solved', 2);
    expect(r.summary('check').max).toBe(12);
    expect(r.counts.get('solved')).toBe(3);
    expect(r.summary('none').count).toBe(0);
  });
});

describe('sseMessages', () => {
  it('returns whole messages and keeps the unfinished rest', () => {
    const { events, rest } = sseMessages('data: {"a":1}\n\nevent: gone\ndata: {}\n\ndata: {"b"');
    expect(events).toEqual([
      { event: 'message', data: '{"a":1}' },
      { event: 'gone', data: '{}' },
    ]);
    expect(rest).toBe('data: {"b"');
  });
  it('joins data lines and skips comments', () => {
    expect(sseMessages(': ping\n\ndata: a\ndata: b\r\n\r\n').events).toEqual([{ event: 'message', data: 'a\nb' }]);
  });
});
