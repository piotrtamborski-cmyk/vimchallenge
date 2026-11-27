/** What the sign-in and account pages say for the codes the account endpoints redirect with. */

export const METHOD_NAME: Record<string, string> = { email: 'an email link', github: 'GitHub', google: 'Google' };

/** "GitHub or an email link" */
export function methodList(methods: string): string {
  const names = methods
    .split(',')
    .map((m) => METHOD_NAME[m])
    .filter(Boolean);
  return names.length ? names.join(' or ') : 'the method you used before';
}

export function errorMessage(code: string | undefined, methods = ''): string | undefined {
  switch (code) {
    case undefined:
      return undefined;
    case 'provider-off':
      return 'That sign-in method is not available on this site.';
    case 'oauth-expired':
      return 'The sign-in took too long, was already used, or was started in another browser. Please try again.';
    case 'oauth-cancelled':
      return 'Sign-in was cancelled.';
    case 'oauth-failed':
      return 'The sign-in did not go through. Please try again, or use another method.';
    case 'email-in-use':
      return `An account already uses this email address. Sign in with ${methodList(methods)}, then connect this method on your account page.`;
    case 'email-invalid':
      return 'That does not look like an email address.';
    case 'email-limit':
      return 'Too many links were sent. Please wait a while before asking for another.';
    case 'email-failed':
      return 'The email could not be sent. Please try again later, or use another method.';
    case 'link-expired':
      return 'This link has expired or was already used. Ask for a new one below.';
    case 'link-other-account':
      return 'Open this link in the browser where you are signed in to the account it adds the address to.';
    case 'linked-elsewhere':
      return 'This sign-in method belongs to another vimchallenge account. Sign in there to use it, or delete that account first.';
    case 'name-invalid':
      return 'A name has 3 to 24 letters, digits, - or _, and starts with a letter or a digit.';
    case 'name-taken':
      return 'Someone already has that name.';
    case 'last-method':
      return 'That is your only way to sign in. Connect another one first, or delete the account.';
    case 'not-connected':
      return 'That method is not connected to this account.';
    case 'confirm-delete':
      return 'Tick the box to confirm that the account should be deleted.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export function noticeMessage(code: string | undefined): string | undefined {
  switch (code) {
    case undefined:
      return undefined;
    case 'renamed':
      return 'Name saved.';
    case 'boards-shown':
      return 'Your name now appears on the public leaderboards.';
    case 'boards-hidden':
      return 'Your name no longer appears on the public leaderboards. You still see your own place.';
    case 'connected-github':
      return 'GitHub is connected: you can sign in with it from now on.';
    case 'connected-google':
      return 'Google is connected: you can sign in with it from now on.';
    case 'connected-email':
      return 'The address is added: you can sign in with a link to it from now on.';
    case 'already-connected':
      return 'That method was already connected to this account.';
    case 'disconnected':
      return 'Disconnected.';
    case 'signed-out-others':
      return 'Signed out on every other device.';
    case 'email-sent':
      return 'Check your inbox and open the link in this browser to add the address. It works once, within 15 minutes.';
    default:
      return undefined;
  }
}
