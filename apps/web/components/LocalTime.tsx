'use client';

/**
 * A moment in the reader's own time zone. The server renders it in UTC; the browser, which knows
 * the zone, writes it again once the page is running.
 */
import { useEffect, useState } from 'react';
import { intlLocale } from '@/lib/i18n/locales';
import { useI18n } from './I18n';

type Style = 'time' | 'date-time';

function format(lang: string, ms: number, style: Style, zone?: string): string {
  const options: Intl.DateTimeFormatOptions =
    style === 'time' ? { hour: '2-digit', minute: '2-digit', timeZone: zone } : { dateStyle: 'medium', timeStyle: 'short', timeZone: zone };
  return new Intl.DateTimeFormat(intlLocale(lang), options).format(ms);
}

export function LocalTime({ ms, style = 'time' }: { ms: number; style?: Style }) {
  const { lang, m, t } = useI18n();
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => setLocal(t(m.common.localTime, { time: format(lang, ms, style) })), [ms, style, lang, m, t]);
  return <time dateTime={new Date(ms).toISOString()}>{local ?? t(m.common.utcTime, { time: format(lang, ms, style, 'UTC') })}</time>;
}
