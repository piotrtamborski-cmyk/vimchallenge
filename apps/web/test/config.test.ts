import { describe, expect, it } from 'vitest';
import { configFromEnv } from '../lib/auth/config.ts';

const production = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;

describe('email links in the configuration', () => {
  it('are off in production without Resend', () => {
    expect(configFromEnv({ ...production, PUBLIC_URL: 'https://vimchallenge.com' }).mailer).toBeUndefined();
  });

  it('go to the log on a plain-HTTP test server with MAIL_TO_LOG=1', () => {
    expect(configFromEnv({ ...production, PUBLIC_URL: 'http://test-box:3100', MAIL_TO_LOG: '1' }).mailer).toBeTypeOf('function');
  });

  it('never go to the log on an HTTPS site', () => {
    const warnings: string[] = [];
    const config = configFromEnv({ ...production, PUBLIC_URL: 'https://vimchallenge.com', MAIL_TO_LOG: '1' }, (w) => warnings.push(w));
    expect(config.mailer).toBeUndefined();
    expect(warnings).toEqual([expect.stringMatching(/MAIL_TO_LOG is ignored/)]);
  });

  it('go through Resend when it is set up, whatever MAIL_TO_LOG says', async () => {
    const config = configFromEnv({ ...production, PUBLIC_URL: 'http://test-box:3100', MAIL_TO_LOG: '1', RESEND_API_KEY: 're_test', MAIL_FROM: 'x <a@b.c>' });
    expect(config.mailer).toBeTypeOf('function');
    // The Resend mailer is the one that talks to api.resend.com.
    expect(config.mailer!.toString()).toContain('api.resend.com');
  });
});
