import type { ServerI18n } from '../i18n/server.ts';

/** What the rooms page says for the codes the room endpoints redirect with. */
export function roomError(i: ServerI18n, code: string | undefined): string | undefined {
  if (!code) return undefined;
  const e = i.m.rooms.error;
  const messages: Record<string, string> = {
    'name-invalid': i.m.auth.nameRules,
    'name-taken': e.nameTaken,
    settings: e.settings,
    full: e.full,
    'not-found': e.notFound,
  };
  return messages[code] ?? i.m.common.somethingWrong;
}
