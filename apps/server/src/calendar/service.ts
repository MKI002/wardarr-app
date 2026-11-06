// "What's coming": the calendars of every Sonarr, Radarr, Lidarr and Readarr
// merged into one, plus revocable iCal feed links.
//
// The same episode or film often sits in two instances (an HD and a 4K
// Sonarr). Those become one entry that names both instances.
import { createHash, randomBytes } from 'node:crypto';
import { AdapterError, type CalendarEntry } from '@wardarr/core';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { calendarFeeds, users } from '../db/schema.js';
import { newId } from '../auth/sessions.js';
import type { AuthUser } from '../auth/types.js';
import type { InstanceRuntime } from '../instances/runtime.js';

const TTL_MS = 5 * 60_000;
const HOUR = 3_600_000;
const MAX_CACHE = 64;
const TOUCH_MS = 5 * 60_000;
/** Feed tokens are 32 random bytes in base64url. */
export const FEED_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface CalendarSource {
  id: string;
  name: string;
  adapter: string;
  adapterName: string;
  error: string | null;
}

export interface CalendarItem extends CalendarEntry {
  /** Stable across instances; the same release in two instances shares it. */
  key: string;
  instances: Array<{ id: string; name: string; adapter: string }>;
}

export interface FeedInfo {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const norm = (s: string | null | undefined) =>
  (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function mergeKey(e: CalendarEntry): string {
  switch (e.kind) {
    case 'episode':
      return `episode|${e.tmdbId ?? norm(e.title)}|${e.seasonNumber ?? '?'}|${e.episodeNumber ?? '?'}`;
    case 'movie':
      return `movie|${e.tmdbId ?? `${norm(e.title)} ${e.year ?? ''}`}|${e.release}`;
    default:
      return `${e.kind}|${norm(e.title)}|${norm(e.subtitle)}`;
  }
}

/** Sort key: an airing's time, or the start of a date-only release's day (UTC). */
const sortTime = (e: CalendarEntry) => Date.parse(e.allDay ? `${e.date.slice(0, 10)}T00:00:00Z` : e.date);

export function mergeEntries(
  lists: Array<{ instance: { id: string; name: string; adapter: string }; entries: CalendarEntry[] }>,
): CalendarItem[] {
  const byKey = new Map<string, CalendarItem>();
  for (const { instance, entries } of lists) {
    for (const e of entries) {
      const key = mergeKey(e);
      const seen = byKey.get(key);
      if (!seen) {
        byKey.set(key, { ...e, key, instances: [instance] });
        continue;
      }
      if (!seen.instances.some((i) => i.id === instance.id)) seen.instances.push(instance);
      seen.hasFile ||= e.hasFile;
      seen.posterPath ??= e.posterPath;
      seen.overview ??= e.overview;
      seen.subtitle ??= e.subtitle;
      seen.runtimeMinutes ??= e.runtimeMinutes;
    }
  }
  return [...byKey.values()].sort(
    (a, b) => sortTime(a) - sortTime(b) || a.title.localeCompare(b.title) || a.key.localeCompare(b.key),
  );
}

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export class CalendarService {
  private readonly cache = new Map<string, { at: number; entries: CalendarEntry[] }>();
  private readonly running = new Map<string, Promise<CalendarEntry[]>>();

  constructor(
    private readonly db: Db,
    private readonly runtime: InstanceRuntime,
    private readonly now: () => Date = () => new Date(),
  ) {
    runtime.onReload(() => this.cache.clear());
  }

  private eligible() {
    return this.runtime
      .snapshots()
      .filter(({ row, def }) => row.enabled && def.capabilities.includes('calendar'));
  }

  private async read(instanceId: string, start: string, end: string): Promise<CalendarEntry[]> {
    const key = `${instanceId}|${start}|${end}`;
    const hit = this.cache.get(key);
    if (hit && this.now().getTime() - hit.at < TTL_MS) return hit.entries;
    const pending = this.running.get(key);
    if (pending) return pending;
    const entry = this.runtime.adapter(instanceId);
    if (!entry?.adapter.calendar) return [];
    const job = entry.gate
      .run(() => entry.adapter.calendar!(start, end))
      .then((entries) => {
        if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { at: this.now().getTime(), entries });
        return entries;
      })
      .finally(() => this.running.delete(key));
    this.running.set(key, job);
    return job;
  }

  /** Everything between two times, merged across instances. */
  async range(start: Date, end: Date): Promise<{ sources: CalendarSource[]; items: CalendarItem[] }> {
    // Whole hours, so the feed and repeated page loads share the cache.
    const from = new Date(Math.floor(start.getTime() / HOUR) * HOUR).toISOString();
    const to = new Date(Math.ceil(end.getTime() / HOUR) * HOUR).toISOString();
    const results = await Promise.all(
      this.eligible().map(async ({ row, def }) => {
        const instance = { id: row.id, name: row.name, adapter: def.id };
        try {
          return { instance, def, entries: await this.read(row.id, from, to), error: null };
        } catch (err) {
          const error = err instanceof AdapterError ? err.kind : 'badResponse';
          return { instance, def, entries: [] as CalendarEntry[], error };
        }
      }),
    );
    const startMs = start.getTime();
    const endMs = end.getTime();
    const items = mergeEntries(results).filter((i) => {
      // Date-only releases count for their whole day.
      const t = sortTime(i);
      return t <= endMs && t + (i.allDay ? 86_400_000 : 0) >= startMs;
    });
    return {
      sources: results.map((r) => ({
        id: r.instance.id,
        name: r.instance.name,
        adapter: r.def.id,
        adapterName: r.def.name,
        error: r.error,
      })),
      items,
    };
  }

  // ------------------------------------------------------------- feeds

  feedOf(userId: string): FeedInfo | null {
    const row = this.db.select().from(calendarFeeds).where(eq(calendarFeeds.userId, userId)).get();
    return row ? { id: row.id, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt } : null;
  }

  /** Creates the user's feed link. An existing link stops working. */
  createFeed(userId: string): { token: string; feed: FeedInfo } {
    const token = randomBytes(32).toString('base64url');
    const feed: FeedInfo = { id: newId(), createdAt: this.now().toISOString(), lastUsedAt: null };
    this.db.transaction((tx) => {
      tx.delete(calendarFeeds).where(eq(calendarFeeds.userId, userId)).run();
      tx.insert(calendarFeeds)
        .values({ id: feed.id, userId, tokenHash: digest(token), createdAt: feed.createdAt })
        .run();
    });
    return { token, feed };
  }

  revokeFeedOf(userId: string): boolean {
    return this.db.delete(calendarFeeds).where(eq(calendarFeeds.userId, userId)).run().changes > 0;
  }

  revokeFeed(id: string): boolean {
    return this.db.delete(calendarFeeds).where(eq(calendarFeeds.id, id)).run().changes > 0;
  }

  /** All feed links, for admins. */
  feeds() {
    return this.db
      .select({
        id: calendarFeeds.id,
        userId: calendarFeeds.userId,
        username: users.username,
        displayName: users.displayName,
        createdAt: calendarFeeds.createdAt,
        lastUsedAt: calendarFeeds.lastUsedAt,
      })
      .from(calendarFeeds)
      .innerJoin(users, eq(users.id, calendarFeeds.userId))
      .all();
  }

  /** The user a feed token belongs to, or null. Disabled users get nothing. */
  resolveFeed(token: string): Pick<AuthUser, 'id' | 'preferences'> | null {
    if (!FEED_TOKEN.test(token)) return null;
    const row = this.db
      .select({ f: calendarFeeds, u: users })
      .from(calendarFeeds)
      .innerJoin(users, eq(users.id, calendarFeeds.userId))
      .where(eq(calendarFeeds.tokenHash, digest(token)))
      .get();
    if (!row || row.u.disabled) return null;
    const now = this.now();
    if (!row.f.lastUsedAt || now.getTime() - Date.parse(row.f.lastUsedAt) > TOUCH_MS) {
      this.db
        .update(calendarFeeds)
        .set({ lastUsedAt: now.toISOString() })
        .where(eq(calendarFeeds.id, row.f.id))
        .run();
    }
    return { id: row.u.id, preferences: row.u.preferences };
  }
}
