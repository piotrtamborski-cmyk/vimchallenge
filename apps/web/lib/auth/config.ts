/**
 * Account settings from the environment. Every sign-in method is optional: GitHub and Google need
 * their OAuth client, email links need Resend (in development they are printed to the log).
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

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const publicUrl = new URL(env.PUBLIC_URL || 'http://localhost:3100');
  let mailer: Mailer | undefined;
  if (env.RESEND_API_KEY && env.MAIL_FROM) mailer = resendMailer(env.RESEND_API_KEY, env.MAIL_FROM);
  else if (env.NODE_ENV !== 'production') mailer = logMailer();
  return {
    publicUrl,
    secure: publicUrl.protocol === 'https:',
    databasePath: env.DATABASE_PATH || '.data/vimchallenge.db',
    github: client(env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET),
    google: client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    mailer,
  };
}
