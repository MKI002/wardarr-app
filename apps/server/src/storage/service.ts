// Disk space of the *arr apps: reads mounts and root folders, folds shared
// disks into one, keeps their history and forecasts when they run full.
import {
  AdapterError,
  DEFAULT_THRESHOLDS,
  dailyPoints,
  diskLevel,
  forecastDisk,
  groupDisks,
  sourceKey,
  type Disk,
  type DiskLevel,
  type DiskReport,
  type Forecast,
  type InstanceRef,
  type KnownDisk,
  type Signal,
  type StorageThresholds,
} from '@wardarr/core';
import { and, asc, desc, eq, gte, lt } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import { diskSamples, disks, storageSettings, type DiskMemberRow } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import type { InstanceRuntime } from '../instances/runtime.js';

const JOB = 'storage:refresh';
const REFRESH_MS = 15 * 60_000;
/** One stored sample per disk and hour is plenty for a forecast in days. */
const SAMPLE_EVERY_MS = 55 * 60_000;
const KEEP_SAMPLES_DAYS = 400;
/** Disks no app reported for this long are forgotten, with their history. */
const FORGET_DISK_DAYS = 30;
/** A disk shows as current when an app reported it within this time. */
const CURRENT_MS = 6 * 3600_000;
const DAY = 86_400_000;

export interface StorageSettings extends StorageThresholds {
  /** Days of history the forecast looks at. */
  lookbackDays: number;
}

export const DEFAULT_STORAGE_SETTINGS: StorageSettings = { ...DEFAULT_THRESHOLDS, lookbackDays: 30 };

export interface DiskView {
  key: string;
  label: string;
  media: boolean;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  lastSeenAt: string;
  members: Array<{
    instanceId: string;
    instanceName: string;
    adapter: string;
    path: string;
    rootFolders: string[];
  }>;
  forecast: Forecast;
  level: DiskLevel;
  reason: 'lowSpace' | 'forecast' | null;
}

export interface DiskHistoryPoint {
  day: string;
  usedBytes: number;
  totalBytes: number;
}

interface Computed {
  views: DiskView[];
  signals: Signal[];
  checked: string[];
}

export class StorageService {
  private running: Promise<void> | null = null;
  private refreshedAt: string | null = null;
  private computed: Computed = { views: [], signals: [], checked: [] };
  /** Instances read successfully in the last refresh. */
  private checkedInstances: string[] = [];
  private failed = new Map<string, AdapterError['kind']>();

  constructor(
    private readonly db: Db,
    private readonly runtime: InstanceRuntime,
    private readonly bus: EventBus,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => Date = () => new Date(),
  ) {
    runtime.registerSignalSource('storage', () => ({
      signals: this.computed.signals,
      checked: this.computed.checked,
    }));
    runtime.onReload(() => this.reschedule());
    runtime.onRecheck(async (ids) => {
      if (ids.some((id) => this.isEligible(id))) await this.refresh();
    });
    this.recompute();
  }

  eligible() {
    return this.runtime
      .snapshots()
      .filter(({ row, def }) => row.enabled && def.capabilities.includes('storage'));
  }

  private isEligible(id: string): boolean {
    return this.eligible().some((e) => e.row.id === id);
  }

  private reschedule(): void {
    const scheduler = this.runtime.schedulerRef;
    if (!scheduler) return;
    if (this.eligible().length === 0) {
      scheduler.cancel(JOB);
      return;
    }
    // Instances changed: read again soon, then every 15 minutes.
    scheduler.schedule(JOB, REFRESH_MS, () => this.refresh(), 5_000);
  }

  settings(): StorageSettings {
    const stored =
      this.db.select().from(storageSettings).where(eq(storageSettings.id, 1)).get()?.config ?? {};
    const out = { ...DEFAULT_STORAGE_SETTINGS } as Record<string, number>;
    for (const key of Object.keys(DEFAULT_STORAGE_SETTINGS))
      if (typeof stored[key] === 'number') out[key] = stored[key] as number;
    return out as unknown as StorageSettings;
  }

  saveSettings(next: StorageSettings): StorageSettings {
    const config = { ...next } as unknown as Record<string, unknown>;
    const updatedAt = this.now().toISOString();
    this.db
      .insert(storageSettings)
      .values({ id: 1, config, updatedAt })
      .onConflictDoUpdate({ target: storageSettings.id, set: { config, updatedAt } })
      .run();
    this.recompute();
    this.runtime.refreshIssues();
    this.bus.publish({ type: 'storage.updated', audience: 'admin' });
    return this.settings();
  }

  /** Reads every app's disks. Runs once at a time. */
  refresh(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.doRefresh().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async doRefresh(): Promise<void> {
    const reports: Array<{ instance: InstanceRef; report: DiskReport }> = [];
    const checked: string[] = [];
    await Promise.all(
      this.eligible().map(async ({ row, def }) => {
        const entry = this.runtime.adapter(row.id);
        if (!entry?.adapter.storage) return;
        try {
          const report = await entry.gate.run(() => entry.adapter.storage!());
          reports.push({ instance: { id: row.id, name: row.name, adapter: def.id }, report });
          checked.push(row.id);
          this.failed.delete(row.id);
        } catch (err) {
          const kind = err instanceof AdapterError ? err.kind : 'badResponse';
          this.failed.set(row.id, kind);
          this.log.debug({ instance: row.id, kind }, 'storage read failed');
        }
      }),
    );
    if (reports.length > 0) this.record(groupDisks(reports, this.known()));
    this.checkedInstances = checked;
    this.refreshedAt = this.now().toISOString();
    this.recompute();
    this.runtime.refreshIssues();
    this.bus.publish({ type: 'storage.updated', audience: 'admin' });
  }

  private known(): KnownDisk[] {
    return this.db
      .select({ key: disks.key, totalBytes: disks.totalBytes, members: disks.members })
      .from(disks)
      .all()
      .map((d) => ({ ...d, members: d.members.map((m) => `${m.instanceId}:${m.path}`) }));
  }

  /** Stores the current state of each disk and, once an hour, a sample. */
  private record(found: Disk[]): void {
    const now = this.now();
    const at = now.toISOString();
    this.db.transaction((tx) => {
      for (const d of found) {
        const members: DiskMemberRow[] = d.members.map((m) => ({
          instanceId: m.instance.id,
          path: m.path,
          rootFolders: m.rootFolders,
        }));
        const values = {
          label: d.label,
          totalBytes: d.totalBytes,
          freeBytes: d.freeBytes,
          media: d.media,
          members,
          lastSeenAt: at,
        };
        tx.insert(disks)
          .values({ key: d.key, firstSeenAt: at, ...values })
          .onConflictDoUpdate({ target: disks.key, set: values })
          .run();
        const last = tx
          .select({ at: diskSamples.at })
          .from(diskSamples)
          .where(eq(diskSamples.diskKey, d.key))
          .orderBy(desc(diskSamples.at))
          .limit(1)
          .get();
        if (!last || now.getTime() - Date.parse(last.at) >= SAMPLE_EVERY_MS) {
          tx.insert(diskSamples)
            .values({ diskKey: d.key, at, freeBytes: d.freeBytes, totalBytes: d.totalBytes })
            .run();
        }
      }
    });
  }

  /** Recomputes forecasts and issue signals from the stored disks. */
  private recompute(): void {
    const now = this.now();
    const settings = this.settings();
    const names = new Map(
      this.runtime.snapshots().map(({ row, def }) => [row.id, { name: row.name, adapter: def.id }]),
    );
    const active = new Set(this.eligible().map((e) => e.row.id));
    const since = new Date(now.getTime() - settings.lookbackDays * DAY).toISOString();
    const views: DiskView[] = [];
    const signals: Signal[] = [];
    for (const d of this.db.select().from(disks).all()) {
      if (now.getTime() - Date.parse(d.lastSeenAt) > CURRENT_MS) continue;
      const members = d.members
        .filter((m) => active.has(m.instanceId))
        .map((m) => ({
          ...m,
          instanceName: names.get(m.instanceId)?.name ?? m.instanceId,
          adapter: names.get(m.instanceId)?.adapter ?? '',
        }));
      if (members.length === 0) continue;
      const samples = this.db
        .select({ at: diskSamples.at, freeBytes: diskSamples.freeBytes, totalBytes: diskSamples.totalBytes })
        .from(diskSamples)
        .where(and(eq(diskSamples.diskKey, d.key), gte(diskSamples.at, since)))
        .all()
        .map((s) => ({ at: s.at, usedBytes: s.totalBytes - s.freeBytes }));
      const forecast = forecastDisk(samples, { freeBytes: d.freeBytes, totalBytes: d.totalBytes }, now, {
        lookbackDays: settings.lookbackDays,
      });
      const { level, reason } = diskLevel(d, forecast, settings);
      views.push({
        key: d.key,
        label: d.label,
        media: d.media,
        totalBytes: d.totalBytes,
        freeBytes: d.freeBytes,
        usedBytes: d.totalBytes - d.freeBytes,
        lastSeenAt: d.lastSeenAt,
        members,
        forecast,
        level,
        reason,
      });
      if (level === 'ok' || !reason) continue;
      const owner = members[0]!;
      signals.push({
        origin: 'service',
        instance: { id: owner.instanceId, name: owner.instanceName, adapter: owner.adapter },
        kind: 'storage',
        source: 'Storage.disk',
        channel: 'storage',
        level: level === 'critical' ? 'error' : 'warning',
        message: `${d.label}: ${d.freeBytes} of ${d.totalBytes} bytes free`,
        data: {
          disk: d.key,
          label: d.label,
          level,
          reason,
          freeBytes: d.freeBytes,
          totalBytes: d.totalBytes,
          percentFree: d.totalBytes > 0 ? (d.freeBytes / d.totalBytes) * 100 : 0,
          daysLeft: forecast.daysLeft ?? 0,
          apps: [...new Set(members.map((m) => m.instanceName))].sort().join(', '),
        },
      });
    }
    const order: Record<DiskLevel, number> = { critical: 0, warning: 1, ok: 2 };
    views.sort(
      (a, b) =>
        order[a.level] - order[b.level] ||
        Number(b.media) - Number(a.media) ||
        a.freeBytes / a.totalBytes - b.freeBytes / b.totalBytes,
    );
    this.computed = {
      views,
      signals,
      checked: this.checkedInstances.map((id) => sourceKey('service', id, 'storage')),
    };
  }

  /** Daily used space of each current disk for the last `days` days. */
  history(days: number): Record<string, DiskHistoryPoint[]> {
    const since = new Date(this.now().getTime() - days * DAY).toISOString();
    const out: Record<string, DiskHistoryPoint[]> = {};
    for (const view of this.computed.views) {
      const rows = this.db
        .select({ at: diskSamples.at, freeBytes: diskSamples.freeBytes, totalBytes: diskSamples.totalBytes })
        .from(diskSamples)
        .where(and(eq(diskSamples.diskKey, view.key), gte(diskSamples.at, since)))
        .orderBy(asc(diskSamples.at))
        .all();
      const totals = new Map(rows.map((r) => [r.at, r.totalBytes]));
      out[view.key] = dailyPoints(rows.map((r) => ({ at: r.at, usedBytes: r.totalBytes - r.freeBytes }))).map(
        (p) => ({
          day: p.at.slice(0, 10),
          usedBytes: p.usedBytes,
          totalBytes: totals.get(p.at) ?? view.totalBytes,
        }),
      );
    }
    return out;
  }

  list(days: number) {
    const eligible = this.eligible();
    return {
      refreshedAt: this.refreshedAt,
      refreshing: this.running !== null,
      settings: this.settings(),
      apps: eligible.map(({ row, def }) => ({
        instanceId: row.id,
        instanceName: row.name,
        adapter: def.id,
        error: this.failed.get(row.id) ?? null,
      })),
      disks: this.computed.views,
      history: this.history(days),
    };
  }

  /** Short summary for the overview. */
  summary() {
    const views = this.computed.views;
    if (views.length === 0) return null;
    const media = views.filter((v) => v.media);
    const counted = media.length > 0 ? media : views;
    const soonest = views
      .filter((v) => v.forecast.status === 'filling' && v.forecast.daysLeft !== null)
      .sort((a, b) => a.forecast.daysLeft! - b.forecast.daysLeft!)[0];
    return {
      disks: counted.length,
      totalBytes: counted.reduce((s, v) => s + v.totalBytes, 0),
      freeBytes: counted.reduce((s, v) => s + v.freeBytes, 0),
      worst: views[0]!.level,
      soonest: soonest
        ? { key: soonest.key, label: soonest.label, daysLeft: soonest.forecast.daysLeft }
        : null,
    };
  }

  prune(): void {
    const now = this.now().getTime();
    const samples = new Date(now - KEEP_SAMPLES_DAYS * DAY).toISOString();
    const forget = new Date(now - FORGET_DISK_DAYS * DAY).toISOString();
    this.db.delete(diskSamples).where(lt(diskSamples.at, samples)).run();
    this.db.delete(disks).where(lt(disks.lastSeenAt, forget)).run();
  }
}
