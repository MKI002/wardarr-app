// Builds an iCalendar (RFC 5545) document from calendar items. Pure, so it
// can be tested without a server.
import { createHash } from 'node:crypto';
import type { Language } from '@wardarr/i18n';
import { t } from '../notifications/render.js';
import type { CalendarItem } from './service.js';

const pad = (n: number) => String(n).padStart(2, '0');

/** `20260310T020000Z` */
export function icsTime(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** `2026-03-10` → `20260310`, and the day after for DTEND. */
function icsDay(day: string, plusDays = 0): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/** Escapes a TEXT value: backslash, semicolon, comma and line breaks. */
export function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds a content line at 75 octets without splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    // Continuation lines start with a space, which counts toward the limit.
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

export function episodeCode(item: Pick<CalendarItem, 'seasonNumber' | 'episodeNumber'>): string {
  if (item.seasonNumber === undefined || item.episodeNumber === undefined) return '';
  return `S${pad(item.seasonNumber)}E${pad(item.episodeNumber)}`;
}

export function summary(lang: Language, item: CalendarItem): string {
  switch (item.kind) {
    case 'episode': {
      const code = episodeCode(item);
      return [item.title, code, item.subtitle].filter(Boolean).join(' · ');
    }
    case 'movie':
      return `${item.title} (${t(lang, `calendar.release.${item.release}`)})`;
    default:
      return item.subtitle ? `${item.title} – ${item.subtitle}` : item.title;
  }
}

function description(lang: Language, item: CalendarItem): string {
  const lines: string[] = [];
  if (item.overview) lines.push(item.overview, '');
  lines.push(t(lang, item.hasFile ? 'calendar.ical.downloaded' : 'calendar.ical.notDownloaded'));
  lines.push(t(lang, 'calendar.ical.from', { instances: item.instances.map((i) => i.name).join(', ') }));
  return lines.join('\n');
}

export const uidOf = (key: string) =>
  `${createHash('sha256').update(key).digest('hex').slice(0, 32)}@wardarr`;

export function buildCalendar(opts: {
  name: string;
  lang: Language;
  items: CalendarItem[];
  now: Date;
}): string {
  const stamp = icsTime(opts.now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Wardarr//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsText(opts.name)}`,
    `NAME:${icsText(opts.name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  for (const item of opts.items) {
    lines.push('BEGIN:VEVENT', `UID:${uidOf(item.key)}`, `DTSTAMP:${stamp}`);
    if (item.allDay) {
      const day = item.date.slice(0, 10);
      lines.push(`DTSTART;VALUE=DATE:${icsDay(day)}`, `DTEND;VALUE=DATE:${icsDay(day, 1)}`);
    } else {
      const start = new Date(item.date);
      const end = new Date(start.getTime() + (item.runtimeMinutes ?? 30) * 60_000);
      lines.push(`DTSTART:${icsTime(start)}`, `DTEND:${icsTime(end)}`);
    }
    lines.push(
      `SUMMARY:${icsText(summary(opts.lang, item))}`,
      `DESCRIPTION:${icsText(description(opts.lang, item))}`,
      `CATEGORIES:${icsText(t(opts.lang, `calendar.kinds.${item.kind}`))}`,
      'TRANSP:TRANSPARENT',
      'STATUS:CONFIRMED',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
