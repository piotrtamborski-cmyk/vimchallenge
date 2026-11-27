'use client';

/** The page's language in the browser: the layout passes the messages the client components use. */
import { createContext, useContext, useMemo } from 'react';
import { makeI18n, type I18n } from '@/lib/i18n/i18n';
import type { ClientMessages } from '@/lib/i18n/messages';

const Context = createContext<{ lang: string; messages: ClientMessages } | null>(null);

export function I18nProvider({ lang, messages, children }: { lang: string; messages: ClientMessages; children: React.ReactNode }) {
  const value = useMemo(() => ({ lang, messages }), [lang, messages]);
  return <Context value={value}>{children}</Context>;
}

/** The page's language, or undefined outside the provider (the layout's header). */
export const usePageLang = () => useContext(Context)?.lang;

export function useI18n(): I18n<ClientMessages> {
  const value = useContext(Context);
  if (!value) throw new Error('useI18n outside I18nProvider');
  return useMemo(() => makeI18n(value.lang, value.messages), [value]);
}
