// The indexer priority watchdog. Once a day it scores every indexer over the
// last 30 days and sets matching priorities: in Prowlarr, and optionally in
// the apps Prowlarr does not keep in sync itself. Off until an admin turns it
// on, and in preview mode it only records what it would change.
import {
  AdapterError,
  DEFAULT_PRIORITY_CONFIG,
  normalizePriorityConfig,
  planPriorities,
  type PriorityConfig,
  type PriorityItem,
} from '@wardarr/core';
import { desc, eq, lt } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../../db/index.js';
import { indexerPriorityLog, indexerPrioritySettings } from '../../db/schema.js';
import type { EventBus } from '../../events/bus.js';
import type { InstanceRuntime } from '../../instances/runtime.js';
import type { IndexerInsightsService } from './service.js';

const JOB = 'indexerPriorities';
/** The job wakes every hour and runs once a day. */
const TICK_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/** A little slack, so an hourly tick that comes a few seconds early still counts. */
const DAY_SLACK_MS = 5 * 60_000;
const LOG_KEEP_DAYS = 180;
/** Scores come from this range of the insights report. */
const SCORE_RANGE = '30d' as const;

export type WatchdogMode = 'preview' | 'apply';

export interface WatchdogConfig extends PriorityConfig {
  enabled: boolean;
  mode: WatchdogMode;
}

export const DEFAULT_WATCHDOG_CONFIG: WatchdogConfig = {
  enabled: false,
  mode: 'preview',
  ...DEFAULT_PRIORITY_CONFIG,
};

export interface WatchdogRun {
  at: string;
  /** What triggered it. */
  trigger: 'schedule' | 'manual';
  mode: WatchdogMode;
  changed: number;
  failed: number;
}

interface WatchdogState {
  lastRun: WatchdogRun | null;
}

export interface WatchdogLogEntry {
  at: string;
  target: 'prowlarr' | 'app';
  instanceId: string;
  instanceName: string | null;
  indexerId: number;
  indexerName: string;
  from: number | null;
  to: number;
  score: number | null;
  preview: boolean;
  error: string | null;
}

export interface WatchdogView {
  config: WatchdogConfig;
  lastRun: WatchdogRun | null;
  nextRunAt: string | null;
  /** True when there is a Prowlarr or an app with indexers to work with. */
  available: boolean;
  items: PriorityItem[];
  apps: Array<{
    instanceId: string;
    instanceName: string;
    adapter: string;
    mode: string;
    syncLevel: 'fullSync' | 'addOnly' | 'disabled' | null;
    prowlarrName: string | null;
  }>;
  log: WatchdogLogEntry[];
}

const kindOf = (err: unknown) => (err instanceof AdapterError ? err.kind : 'badResponse');

export class PriorityWatchdog {
  private running: Promise<WatchdogRun> | null = null;

  constructor(
    private readonly db: Db,
    private readonly runtime: InstanceRuntime,
    private readonly insights: IndexerInsightsService,
    private readonly bus: EventBus,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => Date = () => new Date(),
  ) {
    runtime.onReload(() => this.reschedule());
  }

  // -------------------------------------------------------------- settings

  private row() {
    return this.db.select().from(indexerPrioritySettings).where(eq(indexerPrioritySettings.id, 1)).get();
  }

  config(): WatchdogConfig {
    const stored = (this.row()?.config ?? {}) as Partial<WatchdogConfig>;
    return {
      ...normalizePriorityConfig({ ...DEFAULT_WATCHDOG_CONFIG, ...stored }),
      enabled: stored.enabled === true,
      mode: stored.mode === 'apply' ? 'apply' : 'preview',
    };
  }

  private state(): WatchdogState {
    const s = (this.row()?.state ?? {}) as Partial<WatchdogState>;
    return { lastRun: s.lastRun ?? null };
  }

  private write(patch: { config?: WatchdogConfig; state?: WatchdogState }): void {
    const current = this.row();
    const config = (patch.config ?? current?.config ?? {}) as Record<string, unknown>;
    const state = (patch.state ?? current?.state ?? {}) as Record<string, unknown>;
    const updatedAt = this.now().toISOString();
    this.db
      .insert(indexerPrioritySettings)
      .values({ id: 1, config, state, updatedAt })
      .onConflictDoUpdate({ target: indexerPrioritySettings.id, set: { config, state, updatedAt } })
      .run();
  }

  saveConfig(input: Partial<WatchdogConfig>): WatchdogConfig {
    const merged = { ...this.config(), ...input };
    const next: WatchdogConfig = {
      ...normalizePriorityConfig(merged),
      enabled: merged.enabled === true,
      mode: merged.mode === 'apply' ? 'apply' : 'preview',
    };
    this.write({ config: next });
    this.reschedule();
    this.bus.publish({ type: 'indexers.updated', audience: 'admin' });
    return next;
  }

  // ------------------------------------------------------------ schedule

  reschedule(): void {
    const scheduler = this.runtime.schedulerRef;
    if (!scheduler) return;
    scheduler.cancel(JOB);
    if (!this.config().enabled) return;
    scheduler.schedule(JOB, TICK_MS, () => this.tick(), 60_000);
  }

  nextRunAt(): string | null {
    const config = this.config();
    if (!config.enabled) return null;
    const last = this.state().lastRun;
    const next = last ? Date.parse(last.at) + DAY_MS : this.now().getTime() + 60_000;
    return new Date(Math.max(next, this.now().getTime())).toISOString();
  }

  /** Runs when a day has passed since the last run. */
  async tick(): Promise<void> {
    const config = this.config();
    if (!config.enabled) return;
    const last = this.state().lastRun;
    if (last && this.now().getTime() - Date.parse(last.at) < DAY_MS - DAY_SLACK_MS) return;
    await this.run('schedule');
  }

  // ------------------------------------------------------------------ plan

  private available(): boolean {
    return this.insights.prowlarrInstances().length + this.insights.arrInstances().length > 0;
  }

  /** What a run would do now, with fresh priorities from Prowlarr and the apps. */
  async plan(
    config: WatchdogConfig = this.config(),
    fresh = true,
  ): Promise<{
    items: PriorityItem[];
    apps: WatchdogView['apps'];
  }> {
    // The page shows the last read sources; a run reads them again first.
    const sources = (!fresh && this.insights.cachedSources()) || (await this.insights.refreshSources(fresh));
    const report = this.insights.report(SCORE_RANGE, 'UTC');
    const scores = new Map(report.trackers.map((t) => [t.key, t.metrics.score] as const));
    const items = planPriorities({
      analysis: sources.analysis,
      prowlarrs: sources.prowlarrs.filter((p) => !p.error),
      scores,
      config,
    });
    const apps = sources.analysis.arrs.map((a) => ({
      instanceId: a.instanceId,
      instanceName: a.instanceName,
      adapter: a.adapter,
      mode: a.mode,
      syncLevel: a.prowlarrApp?.syncLevel ?? null,
      prowlarrName: a.prowlarrApp?.prowlarrName ?? null,
    }));
    return { items, apps };
  }

  async view(): Promise<WatchdogView> {
    const config = this.config();
    const available = this.available();
    const { items, apps } = available ? await this.plan(config, false) : { items: [], apps: [] };
    return {
      config,
      lastRun: this.state().lastRun,
      nextRunAt: this.nextRunAt(),
      available,
      items,
      apps,
      log: this.recentLog(),
    };
  }

  // ------------------------------------------------------------------- run

  /** One run in the configured mode. Concurrent calls share the run in flight. */
  run(trigger: WatchdogRun['trigger']): Promise<WatchdogRun> {
    if (!this.running) {
      this.running = this.doRun(trigger).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private async doRun(trigger: WatchdogRun['trigger']): Promise<WatchdogRun> {
    const config = this.config();
    const at = this.now().toISOString();
    const preview = config.mode !== 'apply';
    const { items } = await this.plan(config, true);
    let changed = 0;
    let failed = 0;
    for (const item of items) {
      if (item.reason !== 'change' || item.planned === null) continue;
      let error: string | null = null;
      if (!preview) {
        const entry = this.runtime.adapter(item.instanceId);
        try {
          if (!entry?.adapter.setIndexerPriority)
            throw new AdapterError('unsupported', 'cannot set priority');
          await entry.gate.run(() => entry.adapter.setIndexerPriority!(item.indexerId, item.planned!));
        } catch (err) {
          error = kindOf(err);
          this.log.warn({ instanceId: item.instanceId, indexerId: item.indexerId, err }, 'priority not set');
        }
      }
      if (error) failed++;
      else changed++;
      this.db
        .insert(indexerPriorityLog)
        .values({
          at,
          target: item.target,
          instanceId: item.instanceId,
          indexerId: item.indexerId,
          indexerName: item.indexerName,
          fromPriority: item.current,
          toPriority: item.planned,
          score: item.score,
          preview,
          error,
        })
        .run();
    }
    const run: WatchdogRun = { at, trigger, mode: config.mode, changed, failed };
    this.write({ state: { lastRun: run } });
    this.prune();
    // The next report reads the new priorities.
    if (!preview && changed > 0) await this.insights.refreshSources(true).catch(() => undefined);
    this.bus.publish({ type: 'indexers.updated', audience: 'admin' });
    return run;
  }

  // ------------------------------------------------------------------- log

  recentLog(limit = 100): WatchdogLogEntry[] {
    const names = new Map(this.runtime.snapshots().map(({ row }) => [row.id, row.name]));
    return this.db
      .select()
      .from(indexerPriorityLog)
      .orderBy(desc(indexerPriorityLog.id))
      .limit(limit)
      .all()
      .map((r) => ({
        at: r.at,
        target: r.target === 'app' ? 'app' : 'prowlarr',
        instanceId: r.instanceId,
        instanceName: names.get(r.instanceId) ?? null,
        indexerId: r.indexerId,
        indexerName: r.indexerName,
        from: r.fromPriority,
        to: r.toPriority,
        score: r.score,
        preview: r.preview,
        error: r.error,
      }));
  }

  private prune(): void {
    const before = new Date(this.now().getTime() - LOG_KEEP_DAYS * DAY_MS).toISOString();
    this.db.delete(indexerPriorityLog).where(lt(indexerPriorityLog.at, before)).run();
  }
}
