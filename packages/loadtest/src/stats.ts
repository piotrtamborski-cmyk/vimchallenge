/** Samples of a measurement (in milliseconds) and the numbers a load test reports about them. */

export interface Summary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** The value below which `p` of the sorted samples fall (nearest rank); 0 when there are none. */
export function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export function summarize(samples: readonly number[]): Summary {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? 0,
  };
}

/** Named sample lists and counters, filled while the test runs. */
export class Recorder {
  readonly samples = new Map<string, number[]>();
  readonly counts = new Map<string, number>();

  sample(name: string, ms: number): void {
    const list = this.samples.get(name);
    if (list) list.push(ms);
    else this.samples.set(name, [ms]);
  }

  count(name: string, by = 1): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + by);
  }

  summary(name: string): Summary {
    return summarize(this.samples.get(name) ?? []);
  }
}

/**
 * Splits a Server-Sent Events stream into the data of its messages. Returns the messages complete
 * so far and the unfinished rest to prepend to the next chunk.
 */
export function sseMessages(buffer: string): { events: { event: string; data: string }[]; rest: string } {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n');
  const rest = parts.pop() ?? '';
  const events = parts.flatMap((block) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    return data.length ? [{ event, data: data.join('\n') }] : [];
  });
  return { events, rest };
}
