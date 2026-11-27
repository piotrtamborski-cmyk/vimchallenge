/** Sending the sign-in links: through Resend in production, to the log in development. */

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type Mailer = (mail: Mail) => Promise<void>;

export class MailError extends Error {}

/** Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
export function resendMailer(apiKey: string, from: string, f: typeof fetch = fetch): Mailer {
  return async (mail) => {
    let res: Response;
    try {
      res = await f('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new MailError(`Resend could not be reached: ${(err as Error).message}`);
    }
    if (!res.ok) throw new MailError(`Resend refused the message: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  };
}

/** Prints the message instead of sending it; for development only. */
export function logMailer(log: (line: string) => void = console.log): Mailer {
  return async (mail) => log(`[mail] to ${mail.to}: ${mail.subject}\n${mail.text}`);
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The message with a sign-in link, or with a link that adds the address to an account. */
export function signInMail(to: string, url: string, adding: boolean): Mail {
  const action = adding ? 'add this address to your vimchallenge account' : 'sign in to vimchallenge';
  const subject = adding ? 'Add your email address to vimchallenge' : 'Sign in to vimchallenge';
  const text = [
    `Open this link to ${action}:`,
    '',
    url,
    '',
    'The link works once and expires in 15 minutes. If you didn’t ask for it, ignore this message: nothing happens unless the link is opened.',
  ].join('\n');
  const html = [
    `<p>Open this link to ${escape(action)}:</p>`,
    `<p><a href="${escape(url)}">${escape(adding ? 'Add the address' : 'Sign in')}</a></p>`,
    '<p>The link works once and expires in 15 minutes. If you didn’t ask for it, ignore this message: nothing happens unless the link is opened.</p>',
  ].join('\n');
  return { to, subject, text, html };
}
