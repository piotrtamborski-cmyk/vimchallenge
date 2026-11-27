'use client';

/**
 * A moment in the reader's own time zone. The server renders it in UTC; the browser, which knows
 * the zone, writes it again once the page is running.
 */
import { useEffect, useState } from 'react';

type Style = 'time' | 'date-time';

function format(ms: number, style: Style, zone?: string): string {
  const options: Intl.DateTimeFormatOptions =
    style === 'time' ? { hour: '2-digit', minute: '2-digit', timeZone: zone } : { dateStyle: 'medium', timeStyle: 'short', timeZone: zone };
  return new Intl.DateTimeFormat('en-GB', options).format(ms);
}

export function LocalTime({ ms, style = 'time' }: { ms: number; style?: Style }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => setLocal(`${format(ms, style)} your time`), [ms, style]);
  return <time dateTime={new Date(ms).toISOString()}>{local ?? `${format(ms, style, 'UTC')} UTC`}</time>;
}
