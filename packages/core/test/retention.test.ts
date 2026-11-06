import { describe, expect, it } from 'vitest';
import {
  RETENTION_LEVELS,
  planRetention,
  retentionPolicy,
  simulateRetention,
  type BackupEntry,
} from '../src/backups/retention.js';

const NOW = new Date('2026-06-15T12:00:00');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

function scheduledEvery(hours: number, days: number): BackupEntry[] {
  const out: BackupEntry[] = [];
  for (let h = 0; h < days * 24; h += hours)
    out.push({ id: `s${h}`, createdAt: hoursAgo(h), kind: 'scheduled' });
  return out;
}

describe('smart retention', () => {
  it('keeps every backup of the recent window and one per day after it', () => {
    const policy = retentionPolicy(2);
    const plan = planRetention(scheduledEvery(12, 10), policy, NOW);
    // 24 h window: 0 h, 12 h; plus the newest of each of the last 7 days.
    expect(plan.keep.get('s0')).toEqual(expect.arrayContaining(['latest', 'recent', 'daily']));
    expect(plan.keep.get('s12')).toContain('recent');
    const kept = [...plan.keep.keys()];
    const days = new Set(kept.map((id) => new Date(hoursAgo(Number(id.slice(1)))).getDate()));
    expect(days.size).toBeGreaterThanOrEqual(7);
    expect(plan.remove.length).toBeGreaterThan(0);
  });

  it('never removes manual, uploaded or pinned backups', () => {
    const entries: BackupEntry[] = [
      ...scheduledEvery(24, 400),
      { id: 'm', createdAt: hoursAgo(5000), kind: 'manual' },
      { id: 'u', createdAt: hoursAgo(6000), kind: 'uploaded' },
      { id: 'p', createdAt: hoursAgo(7000), kind: 'scheduled', pinned: true },
    ];
    const plan = planRetention(entries, retentionPolicy(1), NOW);
    for (const id of ['m', 'u', 'p']) expect(plan.keep.has(id)).toBe(true);
    expect(plan.remove).not.toContain('p');
  });

  it('keeps the newest safety backups of each kind', () => {
    const entries: BackupEntry[] = [1, 2, 3, 4, 5].flatMap((i) => [
      { id: `m${i}`, createdAt: hoursAgo(i * 100), kind: 'pre-migration' as const },
      { id: `r${i}`, createdAt: hoursAgo(i * 100 + 1), kind: 'pre-restore' as const },
    ]);
    const plan = planRetention(entries, retentionPolicy(0), NOW);
    expect([...plan.keep.keys()].sort()).toEqual(['m1', 'm2', 'm3', 'r1', 'r2', 'r3']);
    expect(plan.remove).toEqual(['r5', 'm5', 'r4', 'm4']);
  });

  it('keeps the latest automatic backup even at the lowest level', () => {
    const plan = planRetention(scheduledEvery(24, 30), retentionPolicy(0), NOW);
    expect([...plan.keep.keys()]).toEqual(['s0']);
  });

  it('counts only periods that have a backup', () => {
    // Server off for 60 days: the older daily backups are still kept.
    const entries = scheduledEvery(24, 3).concat(
      [61, 62, 63, 64, 65].map((d) => ({
        id: `o${d}`,
        createdAt: hoursAgo(d * 24),
        kind: 'scheduled' as const,
      })),
    );
    const plan = planRetention(entries, retentionPolicy(1), NOW);
    expect(plan.keep.has('o61')).toBe(true);
    expect(plan.keep.has('o64')).toBe(true);
  });

  it('reaches further back and keeps more on higher levels', () => {
    const sims = RETENTION_LEVELS.map((l) => simulateRetention(retentionPolicy(l), NOW));
    expect(sims[0]!.points).toEqual([]);
    for (let i = 2; i < sims.length; i++) {
      expect(sims[i]!.reachDays).toBeGreaterThan(sims[i - 1]!.reachDays);
      expect(sims[i]!.points.length).toBeGreaterThan(sims[i - 1]!.points.length);
    }
    // Level 2: about five months with a few dozen backups.
    expect(sims[2]!.reachDays).toBeGreaterThan(120);
    expect(sims[2]!.points.length).toBeLessThan(30);
  });

  it('keeps a steady set when it runs after every backup', () => {
    // Applying the plan after each new backup ends where one plan over the
    // full history ends.
    const policy = retentionPolicy(2);
    let kept: BackupEntry[] = [];
    const start = NOW.getTime() - 400 * 86_400_000;
    for (let t = start; t <= NOW.getTime(); t += 12 * 3600_000) {
      kept.push({ id: String(t), createdAt: new Date(t).toISOString(), kind: 'scheduled' });
      const plan = planRetention(kept, policy, new Date(t));
      kept = kept.filter((e) => plan.keep.has(e.id));
    }
    const sim = simulateRetention(policy, new Date(kept.at(-1)!.createdAt));
    expect(kept.length).toBe(sim.points.length);
  });
});
