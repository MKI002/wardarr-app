// Smart retention for Wardarr's own backups. One level decides how often a
// backup is made and how the history thins out with age: every backup of the
// last hours, then one per day, one per week and one per month.

export type BackupKind = 'scheduled' | 'manual' | 'pre-migration' | 'pre-restore' | 'uploaded';

export const RETENTION_LEVELS = [0, 1, 2, 3, 4] as const;
export type RetentionLevel = (typeof RETENTION_LEVELS)[number];
export const DEFAULT_RETENTION_LEVEL: RetentionLevel = 2;

export interface RetentionPolicy {
  level: RetentionLevel;
  /** Hours between automatic backups; null makes no automatic backups. */
  intervalHours: number | null;
  /** Every backup younger than this is kept. */
  keepAllHours: number;
  /** Newest backup of each of the last N days, weeks and months that have one. */
  daily: number;
  weekly: number;
  monthly: number;
}

/** Safety backups (before a migration or a restore) kept per kind. */
export const SAFETY_KEEP = 3;

const POLICIES: Record<RetentionLevel, RetentionPolicy> = {
  0: { level: 0, intervalHours: null, keepAllHours: 0, daily: 0, weekly: 0, monthly: 0 },
  1: { level: 1, intervalHours: 24, keepAllHours: 0, daily: 7, weekly: 4, monthly: 3 },
  2: { level: 2, intervalHours: 12, keepAllHours: 24, daily: 7, weekly: 8, monthly: 7 },
  3: { level: 3, intervalHours: 6, keepAllHours: 24, daily: 14, weekly: 8, monthly: 13 },
  4: { level: 4, intervalHours: 3, keepAllHours: 48, daily: 30, weekly: 12, monthly: 25 },
};

export function retentionPolicy(level: number): RetentionPolicy {
  return POLICIES[(RETENTION_LEVELS as readonly number[]).includes(level) ? (level as RetentionLevel) : 2];
}

export interface BackupEntry {
  id: string;
  createdAt: string;
  kind: BackupKind;
  pinned?: boolean;
}

export type KeepReason =
  'pinned' | 'manual' | 'uploaded' | 'safety' | 'latest' | 'recent' | 'daily' | 'weekly' | 'monthly';

export interface RetentionPlan {
  /** Why each kept backup stays; a backup can be kept for several reasons. */
  keep: Map<string, KeepReason[]>;
  /** Backups to delete, oldest first. */
  remove: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
/** Monday of the week, so weeks never depend on the locale. */
function weekKey(d: Date): string {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(monday);
}

/**
 * Decides which backups stay. Automatic backups follow the policy; manual and
 * uploaded backups and pinned ones are never removed; safety backups keep the
 * newest few per kind. Buckets count only periods that have a backup, so a
 * server that was off for a while does not lose its older history.
 */
export function planRetention(entries: BackupEntry[], policy: RetentionPolicy, now: Date): RetentionPlan {
  const keep = new Map<string, KeepReason[]>();
  const add = (id: string, reason: KeepReason) => {
    const list = keep.get(id);
    if (list) {
      if (!list.includes(reason)) list.push(reason);
    } else keep.set(id, [reason]);
  };
  const sorted = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  for (const e of sorted) {
    if (e.pinned) add(e.id, 'pinned');
    if (e.kind === 'manual') add(e.id, 'manual');
    if (e.kind === 'uploaded') add(e.id, 'uploaded');
  }
  for (const kind of ['pre-migration', 'pre-restore'] as const) {
    for (const e of sorted.filter((x) => x.kind === kind).slice(0, SAFETY_KEEP)) add(e.id, 'safety');
  }

  const scheduled = sorted.filter((e) => e.kind === 'scheduled');
  if (scheduled[0]) add(scheduled[0].id, 'latest');
  const cutoff = now.getTime() - policy.keepAllHours * 3600_000;
  for (const e of scheduled) if (Date.parse(e.createdAt) >= cutoff) add(e.id, 'recent');

  const buckets: Array<[KeepReason, number, (d: Date) => string]> = [
    ['daily', policy.daily, dayKey],
    ['weekly', policy.weekly, weekKey],
    ['monthly', policy.monthly, monthKey],
  ];
  for (const [reason, count, key] of buckets) {
    if (count <= 0) continue;
    const seen = new Set<string>();
    for (const e of scheduled) {
      const k = key(new Date(e.createdAt));
      if (seen.has(k)) continue;
      seen.add(k);
      add(e.id, reason);
      if (seen.size >= count) break;
    }
  }

  const remove = sorted
    .filter((e) => !keep.has(e.id))
    .map((e) => e.id)
    .reverse();
  return { keep, remove };
}

export interface RetentionSimulation {
  /** Backups that exist at `now` once the policy has run for a long time. */
  points: Array<{ createdAt: string; reasons: KeepReason[] }>;
  /** Age of the oldest kept backup, in days. */
  reachDays: number;
}

/**
 * Shows what a policy keeps in the long run: automatic backups at every
 * interval for the whole reach of the policy, thinned out by the plan.
 */
export function simulateRetention(policy: RetentionPolicy, now: Date): RetentionSimulation {
  if (policy.intervalHours === null) return { points: [], reachDays: 0 };
  const step = policy.intervalHours * 3600_000;
  const spanDays =
    Math.max(policy.keepAllHours / 24, policy.daily, policy.weekly * 7, policy.monthly * 31) + 31;
  const entries: BackupEntry[] = [];
  for (let t = now.getTime(), i = 0; t > now.getTime() - spanDays * 86_400_000; t -= step, i++) {
    entries.push({ id: String(i), createdAt: new Date(t).toISOString(), kind: 'scheduled' });
  }
  const plan = planRetention(entries, policy, now);
  const points = entries
    .filter((e) => plan.keep.has(e.id))
    .map((e) => ({ createdAt: e.createdAt, reasons: plan.keep.get(e.id)! }));
  const oldest = points.at(-1);
  const reachDays = oldest ? Math.round((now.getTime() - Date.parse(oldest.createdAt)) / 86_400_000) : 0;
  return { points, reachDays };
}
