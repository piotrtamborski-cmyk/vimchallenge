/**
 * Account settings from the environment. Every sign-in method is optional: GitHub and Google need
 * their OAuth client, email links need Resend. In development, and on a test server over plain
 * HTTP with MAIL_TO_LOG=1, email links are printed to the log instead of being sent.
 */
import { logMailer, resendMailer, type ClientConfig, type Mailer } from '@vimchallenge/accounts';

export interface AuthConfig {
  /** Where visitors reach the site; links in emails and OAuth redirects are built from it. */
  publicUrl: URL;
  /** Cookies get `Secure` and the `__Host-` prefix when the site is served over HTTPS. */
  secure: boolean;
  /** The SQLite file; a relative path is taken from the working directory (apps/web). */
  databasePath: string;
  github?: ClientConfig;
  google?: ClientConfig;
  mailer?: Mailer;
}

const client = (id?: string, secret?: string): ClientConfig | undefined =>
  id && secret ? { clientId: id, clientSecret: secret } : undefined;

export function configFromEnv(env: NodeJS.ProcessEnv = process.env, warn: (line: string) => void = console.warn): AuthConfig {
  const publicUrl = new URL(env.PUBLIC_URL || 'http://localhost:3100');
  let mailer: Mailer | undefined;
  if (env.RESEND_API_KEY && env.MAIL_FROM) mailer = resendMailer(env.RESEND_API_KEY, env.MAIL_FROM);
  else if (env.NODE_ENV !== 'production') mailer = logMailer();
  else if (env.MAIL_TO_LOG === '1') {
    // Anyone who can read the log could sign in as anyone: never on a public (HTTPS) site.
    if (publicUrl.protocol === 'https:') warn('MAIL_TO_LOG is ignored: PUBLIC_URL is HTTPS, a public site; set up Resend instead');
    else mailer = logMailer();
  }
  return {
    publicUrl,
    secure: publicUrl.protocol === 'https:',
    databasePath: env.DATABASE_PATH || '.data/vimchallenge.db',
    github: client(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
    google: client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    mailer,
  };
}
