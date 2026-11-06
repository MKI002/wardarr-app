// Stream history. Media servers only report what is playing right now, so
// Wardarr records each play from the session polls.
import type { StreamSession } from '@wardarr/core';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { streamHistory } from '../db/schema.js';
import type { InstanceRuntime } from '../instances/runtime.js';

/** A gap longer than this between two polls is not counted as play time. */
const MAX_GAP_MS = 5 * 60_000;
const KEEP_DAYS = 365;

export interface PlayRow {
  id: number;
  instanceId: string;
  user: string;
  title: string;
  subtitle: string | null;
  mediaType: string;
  startedAt: string;
  endedAt: string | null;
  playedMs: number;
  progress: number;
  transcoding: boolean;
  resolution: string | null;
  client: string | null;
}

export interface StreamStats {
  days: number;
  plays: number;
  playedMs: number;
  transcodes: number;
  /** Plays per user, admins only. */
  users: Array<{ user: string; plays: number; playedMs: number }>;
  topTitles: Array<{ title: string; mediaType: string; plays: number }>;
  perDay: Array<{ day: string; plays: number }>;
  /** Plays by local weekday (0 = Monday) and hour of day: 7 rows of 24 counts. */
  perHour: number[][];
}

export class StreamHistoryService {
  constructor(
    private readonly db: Db,
    runtime: InstanceRuntime,
    private readonly now: () => Date = () => new Date(),
  ) {
    runtime.onPolled((row, snapshot, fresh) => {
      if (fresh.has('sessions') && snapshot.sessions) this.record(row.id, snapshot.sessions);
    });
  }

  /** Updates open plays with the sessions a media server reports right now. */
  record(instanceId: string, sessions: StreamSession[]): void {
    const now = this.now();
    const at = now.toISOString();
    const open = this.db
      .select()
      .from(streamHistory)
      .where(and(eq(streamHistory.instanceId, instanceId), isNull(streamHistory.endedAt)))
      .all();
    const byKey = new Map(open.map((r) => [`${r.sessionId}\u0000${r.title}`, r]));
    const seen = new Set<number>();

    this.db.transaction((tx) => {
      for (const s of sessions) {
        const progress = Math.round(Math.max(0, Math.min(1, s.progress)) * 100);
        const row = byKey.get(`${s.id}\u0000${s.title}`);
        if (row) {
          seen.add(row.id);
          const gap = now.getTime() - Date.parse(row.lastSeenAt);
          const played = s.state === 'playing' && gap > 0 && gap <= MAX_GAP_MS ? gap : 0;
          tx.update(streamHistory)
            .set({
              lastSeenAt: at,
              playedMs: row.playedMs + played,
              progress: Math.max(row.progress, progress),
              transcoding: row.transcoding || s.transcoding,
              resolution: s.resolution ?? row.resolution,
            })
            .where(eq(streamHistory.id, row.id))
            .run();
        } else {
          tx.insert(streamHistory)
            .values({
              instanceId,
              sessionId: s.id,
              user: s.user,
              title: s.title,
              subtitle: s.subtitle ?? null,
              mediaType: s.mediaType,
              startedAt: at,
              lastSeenAt: at,
              durationMs: s.durationMs,
              progress,
              transcoding: s.transcoding,
              resolution: s.resolution ?? null,
              client: s.client ?? s.device ?? null,
            })
            .run();
        }
      }
      // A session the server no longer reports has ended.
      for (const row of open) {
        if (seen.has(row.id)) continue;
        tx.update(streamHistory).set({ endedAt: row.lastSeenAt }).where(eq(streamHistory.id, row.id)).run();
      }
    });
  }

  /** Recent plays, newest first. */
  recent(limit = 50, before?: number): PlayRow[] {
    return this.db
      .select({
        id: streamHistory.id,
        instanceId: streamHistory.instanceId,
        user: streamHistory.user,
        title: streamHistory.title,
        subtitle: streamHistory.subtitle,
        mediaType: streamHistory.mediaType,
        startedAt: streamHistory.startedAt,
        endedAt: streamHistory.endedAt,
        playedMs: streamHistory.playedMs,
        progress: streamHistory.progress,
        transcoding: streamHistory.transcoding,
        resolution: streamHistory.resolution,
        client: streamHistory.client,
      })
      .from(streamHistory)
      .where(before ? lt(streamHistory.id, before) : undefined)
      .orderBy(desc(streamHistory.id))
      .limit(Math.min(Math.max(limit, 1), 200))
      .all();
  }

  /** Aggregated plays of the last `days` days. `withUsers` adds plays per user. */
  stats(days: number, withUsers: boolean, tzMinutes = 0): StreamStats {
    const since = new Date(this.now().getTime() - days * 86_400_000).toISOString();
    const where = gte(streamHistory.startedAt, since);
    const totals = this.db
      .select({
        plays: sql<number>`count(*)`,
        playedMs: sql<number>`coalesce(sum(${streamHistory.playedMs}), 0)`,
        transcodes: sql<number>`coalesce(sum(${streamHistory.transcoding}), 0)`,
      })
      .from(streamHistory)
      .where(where)
      .get() ?? { plays: 0, playedMs: 0, transcodes: 0 };
    const users = withUsers
      ? this.db
          .select({
            user: streamHistory.user,
            plays: sql<number>`count(*)`,
            playedMs: sql<number>`coalesce(sum(${streamHistory.playedMs}), 0)`,
          })
          .from(streamHistory)
          .where(where)
          .groupBy(streamHistory.user)
          .orderBy(desc(sql`count(*)`))
          .limit(50)
          .all()
      : [];
    const topTitles = this.db
      .select({
        title: streamHistory.title,
        mediaType: streamHistory.mediaType,
        plays: sql<number>`count(*)`,
      })
      .from(streamHistory)
      .where(where)
      .groupBy(streamHistory.title, streamHistory.mediaType)
      .orderBy(desc(sql`count(*)`), streamHistory.title)
      .limit(10)
      .all();
    const day = sql<string>`substr(${streamHistory.startedAt}, 1, 10)`;
    const perDay = this.db
      .select({ day, plays: sql<number>`count(*)` })
      .from(streamHistory)
      .where(where)
      .groupBy(day)
      .orderBy(day)
      .all();
    // SQLite shifts the UTC start to the viewer's local time before bucketing.
    const local = sql`datetime(${streamHistory.startedAt}, ${`${tzMinutes >= 0 ? '+' : ''}${tzMinutes} minutes`})`;
    const weekday = sql<string>`strftime('%w', ${local})`;
    const hour = sql<string>`strftime('%H', ${local})`;
    const hourly = this.db
      .select({ weekday, hour, plays: sql<number>`count(*)` })
      .from(streamHistory)
      .where(where)
      .groupBy(weekday, hour)
      .all();
    const perHour = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    for (const h of hourly) {
      // strftime %w counts from Sunday; the grid starts on Monday.
      const row = (Number(h.weekday) + 6) % 7;
      const col = Number(h.hour);
      if (perHour[row] && col >= 0 && col < 24) perHour[row][col] = Number(h.plays);
    }
    return {
      days,
      perHour,
      plays: Number(totals.plays),
      playedMs: Number(totals.playedMs),
      transcodes: Number(totals.transcodes),
      users: users.map((u) => ({ ...u, plays: Number(u.plays), playedMs: Number(u.playedMs) })),
      topTitles: topTitles.map((t) => ({ ...t, plays: Number(t.plays) })),
      perDay: perDay.map((d) => ({ day: d.day, plays: Number(d.plays) })),
    };
  }

  prune(): void {
    const cutoff = new Date(this.now().getTime() - KEEP_DAYS * 86_400_000).toISOString();
    this.db.delete(streamHistory).where(lt(streamHistory.startedAt, cutoff)).run();
  }
}
