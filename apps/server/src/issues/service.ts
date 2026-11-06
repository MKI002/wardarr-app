// Persists issue groups and their history, and publishes changes.
import {
  RULE_CATALOG,
  groupSignals,
  isMuted,
  reconcileIssues,
  type IssueEvent,
  type IssueGroup,
  type RuleContext,
  type Signal,
  type StoredIssue,
} from '@wardarr/core';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { issueEvents, issues } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import { HttpError } from '../http/validate.js';

export interface IssueView extends StoredIssue {
  muted: boolean;
}

export interface IssueHistoryEntry {
  type: string;
  severity: string;
  at: string;
}

export interface IssueTimelineDay {
  /** Local day, YYYY-MM-DD. */
  day: string;
  critical: number;
  warning: number;
  info: number;
}

export class IssueService {
  private stored = new Map<string, StoredIssue>();

  constructor(
    private readonly db: Db,
    private readonly bus: EventBus,
    private readonly ruleContext: () => RuleContext,
    private readonly now: () => Date = () => new Date(),
  ) {
    for (const row of db.select().from(issues).all()) {
      this.stored.set(row.fingerprint, {
        fingerprint: row.fingerprint,
        status: row.status,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        resolvedAt: row.resolvedAt,
        mutedUntil: row.mutedUntil,
        mutedForever: row.mutedForever,
        group: row.group as unknown as IssueGroup,
      });
    }
  }

  private readonly eventListeners: Array<(events: IssueEvent[]) => void> = [];

  /** Called with lifecycle events (opened, resolved, ...) after they were stored. */
  onEvents(listener: (events: IssueEvent[]) => void): void {
    this.eventListeners.push(listener);
  }

  /** Regroups all current signals and merges them into the stored issues. */
  update(signals: Signal[], checkedSources: ReadonlySet<string>) {
    const groups = groupSignals(signals, RULE_CATALOG, this.ruleContext());
    const result = reconcileIssues(this.stored, groups, checkedSources, this.now());
    if (result.upserts.length === 0 && result.events.length === 0) return result;
    this.db.transaction((tx) => {
      for (const issue of result.upserts) {
        const values = {
          fingerprint: issue.fingerprint,
          status: issue.status,
          origin: issue.group.origin,
          severity: issue.group.severity,
          firstSeenAt: issue.firstSeenAt,
          lastSeenAt: issue.lastSeenAt,
          resolvedAt: issue.resolvedAt,
          mutedUntil: issue.mutedUntil,
          mutedForever: issue.mutedForever,
          group: issue.group as unknown as Record<string, unknown>,
        };
        tx.insert(issues)
          .values(values)
          .onConflictDoUpdate({ target: issues.fingerprint, set: values })
          .run();
      }
      for (const e of result.events) {
        tx.insert(issueEvents)
          .values({ fingerprint: e.fingerprint, type: e.type, severity: e.severity, at: e.at })
          .run();
      }
    });
    for (const issue of result.upserts) this.stored.set(issue.fingerprint, issue);
    if (result.events.length > 0) {
      this.bus.publish({ type: 'issues.updated', audience: 'admin' });
      for (const listener of this.eventListeners) listener(result.events);
    }
    return result;
  }

  list(filter: { status?: 'open' | 'resolved' } = {}): IssueView[] {
    const now = this.now();
    return [...this.stored.values()]
      .filter((i) => !filter.status || i.status === filter.status)
      .map((i) => ({ ...i, muted: isMuted(i, now) }))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  get(fingerprint: string): IssueView {
    const issue = this.stored.get(fingerprint);
    if (!issue) throw new HttpError(404, 'notFound');
    return { ...issue, muted: isMuted(issue, this.now()) };
  }

  history(fingerprint: string): IssueHistoryEntry[] {
    return this.db
      .select({ type: issueEvents.type, severity: issueEvents.severity, at: issueEvents.at })
      .from(issueEvents)
      .where(eq(issueEvents.fingerprint, fingerprint))
      .orderBy(desc(issueEvents.at), desc(issueEvents.id))
      .limit(200)
      .all();
  }

  /**
   * Issues that opened (or came back) per day over the last `days` days,
   * oldest first, by severity. `tzMinutes` is the viewer's offset from UTC,
   * so days follow the viewer's calendar. Days without issues are included.
   */
  timeline(days: number, tzMinutes = 0): IssueTimelineDay[] {
    const now = this.now().getTime();
    const shift = tzMinutes * 60_000;
    const localDay = (ms: number) => new Date(ms + shift).toISOString().slice(0, 10);
    const out = new Map<string, IssueTimelineDay>();
    for (let i = days - 1; i >= 0; i--) {
      const day = localDay(now - i * 86_400_000);
      out.set(day, { day, critical: 0, warning: 0, info: 0 });
    }
    const since = new Date(now - (days + 1) * 86_400_000).toISOString();
    const rows = this.db
      .select({ severity: issueEvents.severity, at: issueEvents.at })
      .from(issueEvents)
      .where(and(gte(issueEvents.at, since), inArray(issueEvents.type, ['opened', 'reopened'])))
      .all();
    for (const r of rows) {
      const entry = out.get(localDay(Date.parse(r.at)));
      if (entry && (r.severity === 'critical' || r.severity === 'warning' || r.severity === 'info')) {
        entry[r.severity]++;
      }
    }
    return [...out.values()];
  }

  /** Mutes until a time, or forever when `until` is null. */
  mute(fingerprint: string, until: Date | null, actorUserId: string): IssueView {
    return this.setMute(
      fingerprint,
      until ? until.toISOString() : null,
      until === null,
      'muted',
      actorUserId,
    );
  }

  unmute(fingerprint: string, actorUserId: string): IssueView {
    return this.setMute(fingerprint, null, false, 'unmuted', actorUserId);
  }

  private setMute(
    fingerprint: string,
    mutedUntil: string | null,
    mutedForever: boolean,
    type: string,
    actorUserId: string,
  ) {
    const issue = this.stored.get(fingerprint);
    if (!issue) throw new HttpError(404, 'notFound');
    const next = { ...issue, mutedUntil, mutedForever };
    const at = this.now().toISOString();
    this.db.transaction((tx) => {
      tx.update(issues).set({ mutedUntil, mutedForever }).where(eq(issues.fingerprint, fingerprint)).run();
      tx.insert(issueEvents)
        .values({ fingerprint, type, severity: issue.group.severity, at, actorUserId })
        .run();
    });
    this.stored.set(fingerprint, next);
    this.bus.publish({ type: 'issues.updated', audience: 'admin' });
    return { ...next, muted: isMuted(next, this.now()) };
  }
}
