// Runs the Queue Cleaner per *arr instance on its own schedule, persists its
// state and history, and feeds its findings into the issue engine.
import {
  AdapterError,
  CLEANER_CHANNEL,
  DEFAULT_CLEANER_CONFIG,
  buildDownloads,
  cleanerSignals,
  detectInfrastructure,
  executePlan,
  findOrphans,
  orphanSignals,
  planCleanerRun,
  sourceKey,
  type CleanerConfig,
  type CleanerDownload,
  type CleanerPlan,
  type DownloadJob,
  type DownloadState,
  type ImportPreviewFile,
  type InstanceRef,
  type Msg,
  type Signal,
  type TitleAttempts,
} from '@wardarr/core';
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import { cleanerHistory } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import type { FeatureStore } from '../features/store.js';
import { HttpError } from '../http/validate.js';
import type { InstanceRuntime } from '../instances/runtime.js';

export interface CleanerActivityDay {
  /** Local date, YYYY-MM-DD. */
  day: string;
  strikes: number;
  removed: number;
  imported: number;
}

const FEATURE = 'cleaner';
const PREVIEW_TTL_MS = 10 * 60_000;
const PREVIEWS_PER_RUN = 10;
const ORPHAN_INTERVAL_MS = 15 * 60_000;
const HISTORY_KEEP_DAYS = 90;

interface StoredState {
  downloads: DownloadState[];
  attempts: TitleAttempts[];
  lastRunAt: string | null;
}

const EMPTY_STATE: StoredState = { downloads: [], attempts: [], lastRunAt: null };

interface Live {
  plan: CleanerPlan | null;
  downloads: CleanerDownload[];
  signals: Signal[];
  checked: boolean;
  lastRunAt: string | null;
  error: string | null;
  previews: Map<string, { at: number; files: ImportPreviewFile[] | null }>;
}

export interface Orphan extends DownloadJob {
  clientId: string;
  clientName: string;
}

function errorText(err: unknown): string {
  return err instanceof AdapterError ? err.kind : 'badResponse';
}

export class CleanerService {
  private readonly live = new Map<string, Live>();
  private orphans: Orphan[] = [];
  private orphanSignalsList: Signal[] = [];
  private orphanChecked: string[] = [];

  constructor(
    private readonly db: Db,
    private readonly features: FeatureStore,
    private readonly runtime: InstanceRuntime,
    private readonly bus: EventBus,
    private readonly log: FastifyBaseLogger,
    private readonly now: () => Date = () => new Date(),
  ) {
    runtime.registerSignalSource(FEATURE, () => this.signals());
    runtime.onReload(() => this.reschedule());
    runtime.onRecheck(async (ids) => {
      await Promise.allSettled(ids.filter((id) => this.isEligible(id)).map((id) => this.run(id)));
      if (ids.some((id) => this.isClient(id))) this.checkOrphans();
    });
  }

  /** Instances the cleaner works on: enabled *arr instances with queue actions. */
  eligible() {
    return this.runtime
      .snapshots()
      .filter(
        ({ row, def }) => row.enabled && def.category === 'arr' && def.capabilities.includes('queueActions'),
      );
  }

  isEligible(id: string): boolean {
    return this.eligible().some((e) => e.row.id === id);
  }

  private isClient(id: string): boolean {
    return this.runtime.snapshots().some(({ row, def }) => row.id === id && def.category === 'downloader');
  }

  config(instanceId: string): CleanerConfig {
    return this.features.config(instanceId, FEATURE, DEFAULT_CLEANER_CONFIG);
  }

  saveConfig(instanceId: string, patch: Partial<CleanerConfig>): CleanerConfig {
    // Arming is a deliberate action of its own and never part of a settings save.
    const { dryRun: _ignored, ...rest } = patch;
    const next = { ...this.config(instanceId), ...rest };
    this.features.saveConfig(instanceId, FEATURE, next);
    this.reschedule();
    return next;
  }

  setDryRun(instanceId: string, dryRun: boolean, actorUserId: string): CleanerConfig {
    const next = { ...this.config(instanceId), dryRun };
    this.features.saveConfig(instanceId, FEATURE, next);
    this.record(instanceId, {
      key: '-',
      title: '-',
      kind: dryRun ? 'disarmed' : 'armed',
      rule: '-',
      reason: { key: dryRun ? 'cleaner.reason.disarmed' : 'cleaner.reason.armed' },
      dryRun,
      ok: true,
      actorUserId,
    });
    this.bus.publish({ type: 'cleaner.updated', audience: 'admin' });
    return next;
  }

  private state(instanceId: string): StoredState {
    return this.features.state(instanceId, FEATURE, EMPTY_STATE);
  }

  private liveFor(instanceId: string): Live {
    let l = this.live.get(instanceId);
    if (!l) {
      l = {
        plan: null,
        downloads: [],
        signals: [],
        checked: false,
        lastRunAt: null,
        error: null,
        previews: new Map(),
      };
      this.live.set(instanceId, l);
    }
    return l;
  }

  private reschedule(): void {
    const scheduler = this.runtime.schedulerRef;
    if (!scheduler) return;
    const ids = new Set<string>();
    for (const { row } of this.eligible()) {
      ids.add(row.id);
      const minutes = this.config(row.id).checkIntervalMinutes;
      scheduler.schedule(`cleaner:${row.id}`, minutes * 60_000, () => this.run(row.id), 20_000);
    }
    for (const id of [...this.live.keys()]) {
      if (!ids.has(id)) {
        scheduler.cancel(`cleaner:${id}`);
        this.live.delete(id);
      }
    }
    scheduler.schedule('cleaner:orphans', ORPHAN_INTERVAL_MS, async () => this.checkOrphans(), 120_000);
    scheduler.schedule('cleaner:prune', 24 * 3600_000, async () => this.prune(), 300_000);
  }

  private signals(): { signals: Signal[]; checked: string[] } {
    const signals: Signal[] = [...this.orphanSignalsList];
    const checked: string[] = [...this.orphanChecked];
    for (const [id, l] of this.live) {
      signals.push(...l.signals);
      if (l.checked) checked.push(sourceKey('service', id, CLEANER_CHANNEL));
    }
    // Instances whose cleaner is off have nothing to report.
    for (const { row } of this.eligible()) {
      if (!this.config(row.id).enabled) checked.push(sourceKey('service', row.id, CLEANER_CHANNEL));
    }
    return { signals, checked };
  }

  /** Jobs of all download clients, for speed and orphan checks. */
  private clientJobs(): DownloadJob[] {
    return this.runtime
      .snapshots()
      .filter(({ row, def }) => row.enabled && def.category === 'downloader')
      .flatMap(({ snapshot }) => snapshot.downloads ?? []);
  }

  private async previews(
    instanceId: string,
    downloads: CleanerDownload[],
    live: Live,
  ): Promise<Map<string, ImportPreviewFile[] | null>> {
    const entry = this.runtime.adapter(instanceId);
    const out = new Map<string, ImportPreviewFile[] | null>();
    if (!entry?.adapter.importPreview) return out;
    const nowMs = this.now().getTime();
    let fetched = 0;
    for (const d of downloads) {
      if (d.state !== 'importBlocked' || !d.downloadId) continue;
      const cached = live.previews.get(d.key);
      if (cached && nowMs - cached.at < PREVIEW_TTL_MS) {
        out.set(d.key, cached.files);
        continue;
      }
      if (fetched >= PREVIEWS_PER_RUN) continue;
      fetched++;
      let files: ImportPreviewFile[] | null;
      try {
        files = await entry.gate.run(() => entry.adapter.importPreview!(d.downloadId!));
      } catch {
        files = null;
      }
      live.previews.set(d.key, { at: nowMs, files });
      out.set(d.key, files);
    }
    for (const key of [...live.previews.keys()])
      if (!downloads.some((d) => d.key === key)) live.previews.delete(key);
    return out;
  }

  /** One cleaner run of an instance. */
  async run(instanceId: string): Promise<void> {
    const found = this.eligible().find((e) => e.row.id === instanceId);
    const entry = this.runtime.adapter(instanceId);
    if (!found || !entry?.adapter.queue) return;
    const ref: InstanceRef = { id: found.row.id, name: found.row.name, adapter: found.def.id };
    const config = this.config(instanceId);
    const live = this.liveFor(instanceId);
    const now = this.now();

    if (!config.enabled) {
      Object.assign(live, { plan: null, downloads: [], signals: [], checked: true, error: null });
      this.after();
      return;
    }

    let queue;
    try {
      queue = await entry.gate.run(() => entry.adapter.queue!());
    } catch (err) {
      // Keep the last findings; the issue stays until a run succeeds.
      live.error = errorText(err);
      live.checked = false;
      this.after();
      return;
    }

    const downloads = buildDownloads(queue, this.clientJobs());
    const health = found.snapshot.signals.filter((s) => s.kind === 'health' && s.origin === 'service');
    const infra = detectInfrastructure(downloads, health);
    const previews = infra ? new Map() : await this.previews(instanceId, downloads, live);
    const stored = this.state(instanceId);
    const plan = planCleanerRun({
      config,
      downloads,
      previews,
      infra,
      state: new Map(stored.downloads.map((s) => [s.key, s])),
      attempts: new Map(stored.attempts.map((a) => [a.titleKey, a])),
      now,
      dryRun: config.dryRun,
    });

    const results = await executePlan(
      plan,
      { dryRun: config.dryRun },
      {
        removeQueueItem: (queueId, opts) =>
          entry.gate.run(() => entry.adapter.removeQueueItem!(queueId, opts)),
        search: (target) => entry.gate.run(() => entry.adapter.search!(target)),
      },
    );
    // In a dry run a download at the maximum shows up in every run; note it once.
    const atMax = new Set(stored.downloads.filter((s) => s.strikes >= config.maxStrikes).map((s) => s.key));
    for (const r of results) {
      if (r.dryRun && r.kind !== 'strike' && atMax.has(r.key)) continue;
      this.record(instanceId, {
        key: r.key,
        title: r.title,
        kind: r.kind,
        rule: r.rule,
        reason: r.reason,
        dryRun: r.dryRun,
        ok: r.ok,
        error: r.error ? 'failed' : null,
      });
    }

    this.features.saveState(instanceId, FEATURE, {
      downloads: plan.nextState,
      attempts: plan.nextAttempts,
      lastRunAt: now.toISOString(),
    } satisfies StoredState);
    Object.assign(live, {
      plan,
      downloads,
      signals: cleanerSignals(plan, ref),
      checked: true,
      lastRunAt: now.toISOString(),
      error: null,
    });
    if (!config.dryRun && results.some((r) => r.kind !== 'strike' && r.kind !== 'deferred')) {
      void this.runtime.poll(instanceId);
    }
    this.after();
  }

  private after(): void {
    this.runtime.refreshIssues();
    this.bus.publish({ type: 'cleaner.updated', audience: 'admin' });
  }

  /** What the next run would do, from the last queue, without calling any service. */
  preview(instanceId: string): CleanerPlan | null {
    const live = this.live.get(instanceId);
    if (!live?.plan) return null;
    const config = this.config(instanceId);
    const stored = this.state(instanceId);
    const next = this.nextRunAt(instanceId) ?? this.now();
    return planCleanerRun({
      config,
      downloads: live.downloads,
      previews: new Map([...live.previews].map(([k, v]) => [k, v.files])),
      infra: live.plan.paused,
      state: new Map(stored.downloads.map((s) => [s.key, s])),
      attempts: new Map(stored.attempts.map((a) => [a.titleKey, a])),
      now: next,
      dryRun: config.dryRun,
    });
  }

  nextRunAt(instanceId: string): Date | null {
    const live = this.live.get(instanceId);
    if (!live?.lastRunAt) return null;
    return new Date(Date.parse(live.lastRunAt) + this.config(instanceId).checkIntervalMinutes * 60_000);
  }

  summary() {
    return this.eligible().map(({ row, def }) => {
      const live = this.live.get(row.id);
      const config = this.config(row.id);
      const stored = this.state(row.id);
      return {
        instanceId: row.id,
        instanceName: row.name,
        adapter: def.id,
        adapterName: def.name,
        config,
        lastRunAt: live?.lastRunAt ?? stored.lastRunAt,
        nextRunAt: this.nextRunAt(row.id)?.toISOString() ?? null,
        error: live?.error ?? null,
        paused: live?.plan?.paused ?? null,
        downloads: live?.plan?.downloads ?? [],
        exhausted: stored.attempts.filter((a) => a.attempts >= config.attemptsPerTitle),
        ignored: stored.downloads.filter((d) => d.ignored).map((d) => d.key),
      };
    });
  }

  history(opts: { instanceId?: string; limit: number; before?: number }) {
    const where = and(
      opts.instanceId ? eq(cleanerHistory.instanceId, opts.instanceId) : undefined,
      opts.before ? lt(cleanerHistory.id, opts.before) : undefined,
    );
    return this.db
      .select()
      .from(cleanerHistory)
      .where(where)
      .orderBy(desc(cleanerHistory.id))
      .limit(opts.limit)
      .all();
  }

  /**
   * What the cleaner did per local day: strikes, removals and imports, for
   * the activity chart. Dry-run entries count too; they show what it would do.
   */
  activity(opts: { instanceId?: string; days: number; tzMinutes?: number }): CleanerActivityDay[] {
    const now = this.now().getTime();
    const shift = (opts.tzMinutes ?? 0) * 60_000;
    const localDay = (ms: number) => new Date(ms + shift).toISOString().slice(0, 10);
    const out = new Map<string, CleanerActivityDay>();
    for (let i = opts.days - 1; i >= 0; i--) {
      const day = localDay(now - i * 86_400_000);
      out.set(day, { day, strikes: 0, removed: 0, imported: 0 });
    }
    const since = new Date(now - (opts.days + 1) * 86_400_000).toISOString();
    const rows = this.db
      .select({ kind: cleanerHistory.kind, at: cleanerHistory.at })
      .from(cleanerHistory)
      .where(
        and(
          gte(cleanerHistory.at, since),
          eq(cleanerHistory.ok, true),
          opts.instanceId ? eq(cleanerHistory.instanceId, opts.instanceId) : undefined,
        ),
      )
      .all();
    for (const r of rows) {
      const entry = out.get(localDay(Date.parse(r.at)));
      if (!entry) continue;
      if (r.kind === 'strike') entry.strikes++;
      else if (r.kind === 'remove' || r.kind === 'removeBlocklist') entry.removed++;
      else if (r.kind === 'import') entry.imported++;
    }
    return [...out.values()];
  }

  private record(
    instanceId: string,
    r: {
      key: string;
      title: string;
      kind: string;
      rule: string;
      reason: Msg;
      dryRun: boolean;
      ok: boolean;
      error?: string | null;
      actorUserId?: string;
    },
  ): void {
    this.db
      .insert(cleanerHistory)
      .values({
        instanceId,
        at: this.now().toISOString(),
        downloadKey: r.key,
        title: r.title,
        kind: r.kind,
        rule: r.rule,
        reason: r.reason,
        dryRun: r.dryRun,
        ok: r.ok,
        error: r.error ?? null,
        actorUserId: r.actorUserId ?? null,
      })
      .run();
  }

  private prune(): void {
    const cutoff = new Date(this.now().getTime() - HISTORY_KEEP_DAYS * 86_400_000).toISOString();
    this.db.delete(cleanerHistory).where(lt(cleanerHistory.at, cutoff)).run();
  }

  private download(instanceId: string, key: string): CleanerDownload {
    const d = this.live.get(instanceId)?.downloads.find((x) => x.key === key);
    if (!d) throw new HttpError(404, 'notFound');
    return d;
  }

  private adapterOf(instanceId: string) {
    const entry = this.runtime.adapter(instanceId);
    if (!entry || !this.isEligible(instanceId)) throw new HttpError(404, 'notFound');
    return entry;
  }

  /** "Remove now": a deliberate action, carried out even in a dry run. */
  async removeNow(
    instanceId: string,
    key: string,
    opts: { blocklist: boolean; search: boolean },
    actorUserId: string,
  ) {
    const entry = this.adapterOf(instanceId);
    const d = this.download(instanceId, key);
    const queueId = d.queueIds[0];
    if (queueId === undefined || !entry.adapter.removeQueueItem) throw new HttpError(400, 'unsupported');
    const reason = { key: 'cleaner.reason.manualRemove' };
    try {
      await entry.gate.run(() =>
        entry.adapter.removeQueueItem!(queueId, { removeFromClient: true, blocklist: opts.blocklist }),
      );
    } catch (err) {
      this.record(instanceId, {
        key,
        title: d.title,
        kind: opts.blocklist ? 'removeBlocklist' : 'remove',
        rule: 'manual',
        reason,
        dryRun: false,
        ok: false,
        error: 'failed',
        actorUserId,
      });
      throw new HttpError(502, 'serviceError', { kind: errorText(err) });
    }
    this.record(instanceId, {
      key,
      title: d.title,
      kind: opts.blocklist ? 'removeBlocklist' : 'remove',
      rule: 'manual',
      reason,
      dryRun: false,
      ok: true,
      actorUserId,
    });
    if (opts.search && d.searchTarget && entry.adapter.search) {
      const ok = await entry.gate
        .run(() => entry.adapter.search!(d.searchTarget!))
        .then(
          () => true,
          () => false,
        );
      this.record(instanceId, {
        key,
        title: d.title,
        kind: 'search',
        rule: 'manual',
        reason,
        dryRun: false,
        ok,
        actorUserId,
      });
    }
    await this.runtime.poll(instanceId);
    await this.run(instanceId);
  }

  setIgnored(instanceId: string, key: string, ignored: boolean, actorUserId: string): void {
    const d = this.download(instanceId, key);
    const stored = this.state(instanceId);
    const existing = stored.downloads.find((s) => s.key === key);
    const nowIso = this.now().toISOString();
    const next: DownloadState = existing
      ? { ...existing, ignored, strikes: ignored ? 0 : existing.strikes }
      : {
          key,
          title: d.title,
          firstSeenAt: nowIso,
          problem: null,
          problemSince: null,
          strikes: 0,
          lastStrikeAt: null,
          lastProgressAt: nowIso,
          lastSizeLeft: d.sizeLeftBytes,
          ignored,
        };
    this.features.saveState(instanceId, FEATURE, {
      ...stored,
      downloads: [...stored.downloads.filter((s) => s.key !== key), next],
    });
    this.record(instanceId, {
      key,
      title: d.title,
      kind: ignored ? 'ignored' : 'unignored',
      rule: 'manual',
      reason: { key: ignored ? 'cleaner.reason.manualIgnore' : 'cleaner.reason.manualUnignore' },
      dryRun: false,
      ok: true,
      actorUserId,
    });
    void this.run(instanceId);
  }

  resetAttempts(instanceId: string, titleKey: string, actorUserId: string): void {
    const stored = this.state(instanceId);
    const a = stored.attempts.find((x) => x.titleKey === titleKey);
    if (!a) throw new HttpError(404, 'notFound');
    this.features.saveState(instanceId, FEATURE, {
      ...stored,
      attempts: stored.attempts.filter((x) => x.titleKey !== titleKey),
    });
    this.record(instanceId, {
      key: titleKey,
      title: a.title,
      kind: 'resetAttempts',
      rule: 'manual',
      reason: { key: 'cleaner.reason.manualReset' },
      dryRun: false,
      ok: true,
      actorUserId,
    });
    void this.run(instanceId);
  }

  /** Titles whose attempts are used up, for Hunting. */
  exhaustedKeys(instanceId: string): Set<string> {
    const config = this.config(instanceId);
    return new Set(
      this.state(instanceId)
        .attempts.filter((a) => a.attempts >= config.attemptsPerTitle)
        .map((a) => a.titleKey),
    );
  }

  /** Fresh import preview for "Review import". */
  async importPreview(instanceId: string, key: string): Promise<ImportPreviewFile[]> {
    const entry = this.adapterOf(instanceId);
    const d = this.download(instanceId, key);
    if (!d.downloadId || !entry.adapter.importPreview) throw new HttpError(400, 'unsupported');
    try {
      return await entry.gate.run(() => entry.adapter.importPreview!(d.downloadId!));
    } catch (err) {
      throw new HttpError(502, 'serviceError', { kind: errorText(err) });
    }
  }

  /** Imports the confirmed files. Wardarr never imports on its own. */
  async importConfirmed(
    instanceId: string,
    key: string,
    paths: string[],
    actorUserId: string,
  ): Promise<{ imported: number }> {
    const entry = this.adapterOf(instanceId);
    const d = this.download(instanceId, key);
    const files = (await this.importPreview(instanceId, key)).filter(
      (f) => paths.includes(f.path) && f.target && f.rejections.length === 0,
    );
    if (files.length === 0) throw new HttpError(400, 'nothingToImport');
    const reason = { key: 'cleaner.reason.manualImport', params: { count: files.length } };
    try {
      await entry.gate.run(() => entry.adapter.importFiles!(d.downloadId!, files));
    } catch (err) {
      this.record(instanceId, {
        key,
        title: d.title,
        kind: 'import',
        rule: 'manual',
        reason,
        dryRun: false,
        ok: false,
        error: 'failed',
        actorUserId,
      });
      throw new HttpError(502, 'serviceError', { kind: errorText(err) });
    }
    this.record(instanceId, {
      key,
      title: d.title,
      kind: 'import',
      rule: 'manual',
      reason,
      dryRun: false,
      ok: true,
      actorUserId,
    });
    this.liveFor(instanceId).previews.delete(key);
    void this.runtime.poll(instanceId);
    return { imported: files.length };
  }

  /**
   * Finds client jobs no *arr instance knows. Only runs when every *arr
   * queue is known, so a missing queue never makes a job look orphaned.
   */
  checkOrphans(): void {
    const snaps = this.runtime.snapshots().filter(({ row }) => row.enabled);
    const arrs = snaps.filter(({ def }) => def.category === 'arr' && def.capabilities.includes('queue'));
    if (
      arrs.length === 0 ||
      arrs.some(({ snapshot }) => snapshot.queue === null || snapshot.status === 'down')
    )
      return;
    const known = arrs.flatMap(({ snapshot }) =>
      (snapshot.queue ?? []).map((q) => q.downloadId).filter((x): x is string => !!x),
    );
    const orphans: Orphan[] = [];
    const signals: Signal[] = [];
    const checked: string[] = [];
    for (const { row, def, snapshot } of snaps.filter(({ def }) => def.category === 'downloader')) {
      if (!snapshot.downloads) continue;
      const found = findOrphans(snapshot.downloads, known, { now: this.now(), minAgeMinutes: 60 });
      orphans.push(...found.map((j) => ({ ...j, clientId: row.id, clientName: row.name })));
      signals.push(...orphanSignals(found, { id: row.id, name: row.name, adapter: def.id }));
      checked.push(sourceKey('service', row.id, CLEANER_CHANNEL));
    }
    this.orphans = orphans;
    this.orphanSignalsList = signals;
    this.orphanChecked = checked;
    this.after();
  }

  orphanList(): Orphan[] {
    return this.orphans;
  }

  /** Deletes an orphaned job after the user confirmed it. */
  async deleteOrphan(
    clientId: string,
    jobId: string,
    deleteFiles: boolean,
    actorUserId: string,
  ): Promise<void> {
    const orphan = this.orphans.find((o) => o.clientId === clientId && o.id === jobId);
    const entry = this.runtime.adapter(clientId);
    if (!orphan || !entry) throw new HttpError(404, 'notFound');
    if (!entry.adapter.removeDownload) throw new HttpError(400, 'unsupported');
    try {
      await entry.gate.run(() => entry.adapter.removeDownload!(jobId, { deleteFiles }));
    } catch (err) {
      throw new HttpError(502, 'serviceError', { kind: errorText(err) });
    }
    this.record(clientId, {
      key: jobId,
      title: orphan.name,
      kind: 'deleteOrphan',
      rule: 'orphan',
      reason: { key: 'cleaner.reason.orphanDeleted' },
      dryRun: false,
      ok: true,
      actorUserId,
    });
    this.orphans = this.orphans.filter((o) => o !== orphan);
    this.orphanSignalsList = this.orphanSignalsList.filter(
      (s) => !(s.instance.id === clientId && s.data?.jobId === jobId),
    );
    await this.runtime.poll(clientId);
    this.after();
  }
}
