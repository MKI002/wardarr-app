// Issue lifecycle: open, update, resolve and reopen groups between polls.
// Pure functions; the server persists the result.
import type { IssueGroup, IssueOrigin } from './types.js';

export type IssueStatus = 'open' | 'resolved';

export interface StoredIssue {
  fingerprint: string;
  status: IssueStatus;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  mutedUntil: string | null;
  mutedForever: boolean;
  group: IssueGroup;
}

export type IssueEventType = 'opened' | 'reopened' | 'resolved' | 'severityChanged';

export interface IssueEvent {
  fingerprint: string;
  type: IssueEventType;
  at: string;
  severity: IssueGroup['severity'];
}

export interface ReconcileResult {
  /** Issues whose stored state changed and must be written. */
  upserts: StoredIssue[];
  events: IssueEvent[];
  /** New or reopened groups that are not muted; candidates for notifications. */
  notify: StoredIssue[];
}

/** Key of a source that was checked in this round, see `sourceKey`. */
export function sourceKey(origin: IssueOrigin, instanceId: string): string {
  return `${origin}:${instanceId}`;
}

export function isMuted(issue: Pick<StoredIssue, 'mutedForever' | 'mutedUntil'>, now: Date): boolean {
  if (issue.mutedForever) return true;
  return issue.mutedUntil !== null && new Date(issue.mutedUntil).getTime() > now.getTime();
}

/**
 * Merges the groups of the current round into the stored issues.
 *
 * An open issue is resolved only when every source that reported it was
 * checked successfully in this round and no longer reports it. A source that
 * could not be checked (for example an unreachable instance) keeps its
 * issues open, so an outage never looks like a fix.
 */
export function reconcileIssues(
  stored: ReadonlyMap<string, StoredIssue>,
  current: readonly IssueGroup[],
  checkedSources: ReadonlySet<string>,
  now: Date,
): ReconcileResult {
  const at = now.toISOString();
  const upserts: StoredIssue[] = [];
  const events: IssueEvent[] = [];
  const notify: StoredIssue[] = [];
  const seen = new Set<string>();

  for (const group of current) {
    seen.add(group.fingerprint);
    const prev = stored.get(group.fingerprint);
    if (!prev) {
      const issue: StoredIssue = {
        fingerprint: group.fingerprint,
        status: 'open',
        firstSeenAt: at,
        lastSeenAt: at,
        resolvedAt: null,
        mutedUntil: null,
        mutedForever: false,
        group,
      };
      upserts.push(issue);
      events.push({ fingerprint: group.fingerprint, type: 'opened', at, severity: group.severity });
      notify.push(issue);
      continue;
    }
    const issue: StoredIssue = { ...prev, status: 'open', lastSeenAt: at, resolvedAt: null, group };
    if (prev.status === 'resolved') {
      events.push({ fingerprint: group.fingerprint, type: 'reopened', at, severity: group.severity });
      if (!isMuted(issue, now)) notify.push(issue);
    } else if (prev.group.severity !== group.severity) {
      events.push({ fingerprint: group.fingerprint, type: 'severityChanged', at, severity: group.severity });
    }
    upserts.push(issue);
  }

  for (const prev of stored.values()) {
    if (prev.status !== 'open' || seen.has(prev.fingerprint)) continue;
    const sources = prev.group.instances.map((i) => sourceKey(prev.group.origin, i.id));
    const allChecked = sources.length > 0 && sources.every((s) => checkedSources.has(s));
    if (!allChecked) continue;
    upserts.push({ ...prev, status: 'resolved', resolvedAt: at });
    events.push({ fingerprint: prev.fingerprint, type: 'resolved', at, severity: prev.group.severity });
  }

  return { upserts, events, notify };
}
