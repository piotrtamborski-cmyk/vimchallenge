/**
 * Per-client rate limit: a token bucket per client address, kept in this process's memory
 * (the web app runs as one process). A client may send `burst` requests at once and then one
 * every 60 / `perMinute` seconds.
 */

export interface RateLimitOptions {
  perMinute: number;
  burst: number;
  /** Clients remembered at once; the least recently seen are forgotten first. */
  maxClients: number;
  /** Clock in milliseconds (tests pass their own). */
  now?: () => number;
}

export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

interface Bucket {
  tokens: number;
  at: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly options: RateLimitOptions;
  private readonly perMs: number;
  private readonly now: () => number;

  constructor(options: RateLimitOptions) {
    this.options = options;
    this.perMs = options.perMinute / 60_000;
    this.now = options.now ?? Date.now;
  }

  take(client: string): RateDecision {
    const now = this.now();
    const old = this.buckets.get(client);
    const tokens = old ? Math.min(this.options.burst, old.tokens + (now - old.at) * this.perMs) : this.options.burst;
    // Map order is insertion order: re-inserting keeps the least recently seen client first.
    this.buckets.delete(client);
    if (tokens < 1) {
      this.buckets.set(client, { tokens, at: now });
      return { allowed: false, retryAfterSeconds: Math.ceil((1 - tokens) / this.perMs / 1000) };
    }
    this.buckets.set(client, { tokens: tokens - 1, at: now });
    while (this.buckets.size > this.options.maxClients) this.buckets.delete(this.buckets.keys().next().value!);
    return { allowed: true };
  }

  get size(): number {
    return this.buckets.size;
  }
}

/**
 * The client's address from the request headers. `header` names one set by a trusted proxy, e.g.
 * `cf-connecting-ip` behind Cloudflare. Without it, the last `x-forwarded-for` entry is used: the
 * address the nearest proxy saw, or the socket address Next fills in when there is no proxy.
 * IPv6 clients are grouped by /64, the block one subscriber usually gets.
 */
export function clientKey(headers: Headers, header?: string): string {
  const raw = header ? headers.get(header) : headers.get('x-forwarded-for')?.split(',').at(-1);
  const ip = raw?.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  if (!ip) return 'unknown';
  if (!ip.includes(':')) return ip;
  return ipv6Prefix64(ip);
}

function ipv6Prefix64(ip: string): string {
  const [head = '', tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => parseInt(g || '0', 16).toString(16)).join(':')}::/64`;
}
