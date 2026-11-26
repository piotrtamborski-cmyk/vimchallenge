import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <article className="max-w-3xl space-y-6 leading-relaxed">
      <h1 className="text-2xl font-semibold">Privacy</h1>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Playing without an account</h2>
        <p>
          Nothing is stored. Your keys are judged in your browser; when you solve a task, the server replays them to confirm the
          solve and then forgets them. To limit how often a network can ask for checks, the web server counts requests per network
          address in its memory for a few minutes; the count is never written down.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">With an account</h2>
        <ul className="list-inside list-disc space-y-1">
          <li>Your name, which you choose and can change.</li>
          <li>
            How you sign in: an email address, or the user number GitHub or Google gives the account you sign in with, with the
            address they verified for it. That address is only used to spot a second account of the same person.
          </li>
          <li>Your sessions: when each started and was last used. The cookie holds a random token; only its hash is stored.</li>
          <li>Each solve the server confirmed: the task, which text, the time and the number of keys. Never the keys themselves.</li>
          <li>Sign-in links sent by email, with their address, for a day.</li>
        </ul>
        <p>Nothing is sold or shared, and there is no tracking, advertising or analytics.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">In a room</h2>
        <p>
          The name you choose for the room, whether you are ready, when your page was last connected, and for each round the keys
          you typed, your result, time and points. The keys are kept so the server can judge your run and a reload can carry on
          where you were. Other players see your name, your status and your results, never your keys. Everything about a room
          is deleted a week after its last activity. A solve of a signed-in player also goes to their progress, as in training.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Cookies</h2>
        <p>
          One cookie keeps you signed in. While you sign in with GitHub or Google, a second one lives for ten minutes to tie the
          sign-in to your browser. A guest who creates or joins a room gets a third, for 30 days, so the room knows them again;
          it holds a random token, of which only a hash is stored. All are needed for what you asked the site to do, so there is
          nothing to consent to.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Services involved</h2>
        <p>
          The site is delivered through Cloudflare, which sees your network address while it does so. Sign-in emails are sent
          through Resend. GitHub and Google take part only when you choose to sign in with them.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Deleting</h2>
        <p>
          Your{' '}
          <Link href="/account" className="underline">
            account page
          </Link>{' '}
          deletes the account with everything above at once. Backup copies of the database are kept for 14 days, so deleted data
          leaves them within two weeks.
        </p>
      </section>

      <p className="text-sm text-muted">
        The code that does all this is public:{' '}
        <a className="underline" href="https://github.com/piotrtamborski-cmyk/vimchallenge">
          github.com/piotrtamborski-cmyk/vimchallenge
        </a>
        .
      </p>
    </article>
  );
}
