import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, newNonce } from '../lib/csp.ts';
import { proxy } from '../proxy.ts';

const directives = (policy: string) =>
  Object.fromEntries(policy.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1).join(' ')]));

describe('contentSecurityPolicy', () => {
  it('allows scripts and styles only with the nonce in production', () => {
    const d = directives(contentSecurityPolicy('abc'));
    expect(d['script-src']).toBe("'self' 'nonce-abc' 'strict-dynamic'");
    expect(d['style-src']).toBe("'self' 'nonce-abc'");
    expect(d['object-src']).toBe("'none'");
    expect(d['frame-ancestors']).toBe("'none'");
    expect(d['base-uri']).toBe("'self'");
    expect(contentSecurityPolicy('abc')).not.toContain('unsafe');
  });
  it('relaxes eval and inline styles in development only', () => {
    const d = directives(contentSecurityPolicy('abc', true));
    expect(d['script-src']).toBe("'self' 'nonce-abc' 'strict-dynamic' 'unsafe-eval'");
    expect(d['style-src']).toBe("'self' 'unsafe-inline'");
  });
});

describe('newNonce', () => {
  it('is 128 random bits, new every time', () => {
    const nonces = new Set(Array.from({ length: 100 }, newNonce));
    expect(nonces.size).toBe(100);
    for (const n of nonces) expect(atob(n)).toHaveLength(16);
  });
});

describe('proxy', () => {
  it('sends the policy with a fresh nonce and hands the nonce to the rendering', () => {
    const first = proxy(new NextRequest('http://localhost/tasks/undo-a-change'));
    const second = proxy(new NextRequest('http://localhost/tasks/undo-a-change'));
    const policy = first.headers.get('content-security-policy')!;
    const nonce = /'nonce-([^']+)'/.exec(policy)![1]!;
    expect(second.headers.get('content-security-policy')).not.toContain(nonce);
    // NextResponse.next passes overridden request headers on as x-middleware-request-*.
    expect(first.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
  });
});
