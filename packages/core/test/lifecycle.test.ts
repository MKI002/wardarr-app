import { describe, expect, it } from 'vitest';
import { reconcileIssues, sourceKey, type IssueGroup, type StoredIssue } from '../src/index.js';

const inst = { id: 'a', name: 'Sonarr', adapter: 'sonarr' };

function group(fingerprint: string, severity: IssueGroup['severity'] = 'warning'): IssueGroup {
  return {
    fingerprint,
    ruleId: fingerprint.split(':')[0]!,
    origin: 'service',
    severity,
    title: { key: 'x' },
    affected: { key: 'x' },
    explanation: { key: 'x' },
    fix: { key: 'x' },
    instances: [inst],
    sources: [sourceKey('service', 'a')],
    details: [],
    items: [],
    actions: [],
  };
}

const t0 = new Date('2026-01-01T00:00:00Z');
const t1 = new Date('2026-01-01T01:00:00Z');

function store(issues: StoredIssue[]) {
  return new Map(issues.map((i) => [i.fingerprint, i]));
}

describe('reconcileIssues', () => {
  it('opens new issues and asks to notify', () => {
    const r = reconcileIssues(new Map(), [group('r:1')], new Set([sourceKey('service', 'a')]), t0);
    expect(r.events.map((e) => e.type)).toEqual(['opened']);
    expect(r.notify).toHaveLength(1);
  });

  it('does not notify again for an issue that stays open', () => {
    const first = reconcileIssues(new Map(), [group('r:1')], new Set(), t0);
    const second = reconcileIssues(store(first.upserts), [group('r:1')], new Set(), t1);
    expect(second.events).toHaveLength(0);
    expect(second.notify).toHaveLength(0);
    expect(second.upserts[0]!.firstSeenAt).toBe(t0.toISOString());
  });

  it('resolves an issue when its source was checked and no longer reports it', () => {
    const first = reconcileIssues(new Map(), [group('r:1')], new Set(), t0);
    const second = reconcileIssues(store(first.upserts), [], new Set([sourceKey('service', 'a')]), t1);
    expect(second.upserts[0]!.status).toBe('resolved');
    expect(second.events[0]!.type).toBe('resolved');
  });

  it('keeps an issue open while its source could not be checked', () => {
    const first = reconcileIssues(new Map(), [group('r:1')], new Set(), t0);
    const second = reconcileIssues(store(first.upserts), [], new Set(), t1);
    expect(second.upserts).toHaveLength(0);
  });

  it('reopens a resolved issue, but stays quiet when muted', () => {
    const first = reconcileIssues(new Map(), [group('r:1')], new Set(), t0);
    const resolved = reconcileIssues(store(first.upserts), [], new Set([sourceKey('service', 'a')]), t1);
    const muted = { ...resolved.upserts[0]!, mutedForever: true };
    const again = reconcileIssues(store([muted]), [group('r:1')], new Set(), t1);
    expect(again.events[0]!.type).toBe('reopened');
    expect(again.notify).toHaveLength(0);
  });

  it('records a severity change', () => {
    const first = reconcileIssues(new Map(), [group('r:1', 'warning')], new Set(), t0);
    const second = reconcileIssues(store(first.upserts), [group('r:1', 'critical')], new Set(), t1);
    expect(second.events[0]!.type).toBe('severityChanged');
  });
});
