/** What the sign-in and account pages say for the codes the account endpoints redirect with. */
import type { ServerI18n } from '../i18n/server.ts';

type Auth = ServerI18n['m']['auth'];

/** The account endpoints' error codes, as message names. */
const ERROR: Record<string, keyof Auth['error'] | 'nameRules'> = {
  'provider-off': 'providerOff',
  'oauth-expired': 'oauthExpired',
  'oauth-cancelled': 'oauthCancelled',
  'oauth-failed': 'oauthFailed',
  'email-in-use': 'emailInUse',
  'email-invalid': 'emailInvalid',
  'email-limit': 'emailLimit',
  'email-failed': 'emailFailed',
  'link-expired': 'linkExpired',
  'link-other-account': 'linkOtherAccount',
  'linked-elsewhere': 'linkedElsewhere',
  'name-invalid': 'nameRules',
  'name-taken': 'nameTaken',
  'last-method': 'lastMethod',
  'not-connected': 'notConnected',
  'confirm-delete': 'confirmDelete',
};

const NOTICE: Record<string, keyof Auth['notice']> = {
  renamed: 'renamed',
  'boards-shown': 'boardsShown',
  'boards-hidden': 'boardsHidden',
  'connected-github': 'connectedGithub',
  'connected-google': 'connectedGoogle',
  'connected-email': 'connectedEmail',
  'already-connected': 'alreadyConnected',
  disconnected: 'disconnected',
  'signed-out-others': 'signedOutOthers',
  'email-sent': 'emailSent',
};

/** "GitHub or an email link" */
export function methodList(i: ServerI18n, methods: string): string {
  const a = i.m.auth;
  const names = methods
    .split(',')
    .map((m) => a.methodName[m as keyof Auth['methodName']])
    .filter(Boolean);
  return names.length ? i.list(names, 'disjunction') : a.methodBefore;
}

export function errorMessage(i: ServerI18n, code: string | undefined, methods = ''): string | undefined {
  if (code === undefined) return undefined;
  const a = i.m.auth;
  const name = ERROR[code];
  if (!name) return i.m.common.somethingWrong;
  if (name === 'nameRules') return a.nameRules;
  return i.t(a.error[name], { methods: methodList(i, methods) });
}

export function noticeMessage(i: ServerI18n, code: string | undefined): string | undefined {
  const name = code === undefined ? undefined : NOTICE[code];
  return name && i.m.auth.notice[name];
}
