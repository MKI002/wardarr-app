// Types and date helpers for the calendar page.
export type CalendarKind = 'episode' | 'movie' | 'album' | 'book';
export type CalendarRelease = 'airing' | 'cinema' | 'digital' | 'physical' | 'release';

export interface CalendarItem {
  key: string;
  kind: CalendarKind;
  release: CalendarRelease;
  title: string;
  subtitle: string | null;
  seasonNumber?: number;
  episodeNumber?: number;
  date: string;
  allDay: boolean;
  runtimeMinutes: number | null;
  hasFile: boolean;
  monitored: boolean;
  premiere?: 'series' | 'season';
  finale?: 'series' | 'season' | 'midseason';
  year: number | null;
  posterPath: string | null;
  network: string | null;
  overview: string | null;
  instances: Array<{ id: string; name: string; adapter: string }>;
}

export interface CalendarSource {
  id: string;
  name: string;
  adapter: string;
  adapterName: string;
  error: string | null;
}

export interface CalendarData {
  sources: CalendarSource[];
  items: CalendarItem[];
}

export const KINDS: CalendarKind[] = ['episode', 'movie', 'album', 'book'];

/** Steps of the accent for each kind, strongest for episodes (sequential, one hue). */
export const KIND_SHADE: Record<CalendarKind, number> = { episode: 1, movie: 0.62, album: 0.4, book: 0.26 };

const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of a local date. */
export function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local day an item belongs to. Date-only releases keep their day. */
export function itemDay(item: Pick<CalendarItem, 'date' | 'allDay'>): string {
  return item.allDay ? item.date.slice(0, 10) : dayKeyOf(new Date(item.date));
}

/** Local midnight of a day key. */
export function dayStart(key: string): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** When an item counts as "out": its air time, or the start of its day. */
export function itemTime(item: Pick<CalendarItem, 'date' | 'allDay'>): number {
  return item.allDay ? dayStart(item.date.slice(0, 10)).getTime() : Date.parse(item.date);
}

/** Released, but without a file. Cinema releases cannot be downloaded yet. */
export function isMissing(item: CalendarItem, now: number): boolean {
  if (item.hasFile || item.release === 'cinema') return false;
  const end = item.allDay
    ? itemTime(item) + 86_400_000
    : itemTime(item) + (item.runtimeMinutes ?? 30) * 60_000;
  return end < now;
}

export function episodeCode(item: Pick<CalendarItem, 'seasonNumber' | 'episodeNumber'>): string | null {
  if (item.seasonNumber === undefined || item.episodeNumber === undefined) return null;
  return `S${pad(item.seasonNumber)}E${pad(item.episodeNumber)}`;
}

export function calendarUrl(start: Date, end: Date): string {
  const q = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
  return `/api/calendar?${q.toString()}`;
}

/** Groups items by local day, in order. */
export function byDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const out = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const key = itemDay(item);
    const list = out.get(key);
    if (list) list.push(item);
    else out.set(key, [item]);
  }
  return out;
}
