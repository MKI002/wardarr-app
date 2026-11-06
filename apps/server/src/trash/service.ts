// TRaSH Guides sync: keeps the guide data, templates and assignments, plans
// and applies syncs with backups, and runs the guard that watches for drift.
//
// Settings in an instance change only through a confirmed action: a sync the
// admin started after the preview, or the guard in auto mode, which the admin
// switched on for that instance with an explicit confirmation.
import {
  AdapterError,
  TRASH_PRODUCTS,
  brakesFor,
  buildPlan,
  diffGuides,
  executeSyncPlan,
  filterPlan,
  groupsForProfile,
  mergeApplied,
  parseGuide,
  profileFormats,
  profileCategories,
  releaseScore,
  resolveTemplate,
  restoreBackup,
  scoreFor,
  sameValue,
  sourceKey,
  suggestedTemplateProfile,
  NAMING_FIELDS,
  type AppliedState,
  type ArrSnapshot,
  type BrakeReason,
  type ChangeOrigin,
  type DesiredState,
  type GuideChange,
  type ManagedIds,
  type ProfileSyncApi,
  type Signal,
  type SyncBackup,
  type SyncPlan,
  type TemplateConfig,
  type TemplateProfile,
  type TrashGuide,
  type TrashProduct,
} from '@wardarr/core';
import { and, desc, eq, isNotNull, lt, notInArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { newId } from '../auth/sessions.js';
import type { Db } from '../db/index.js';
import { trashAssignments, trashFiles, trashHistory, trashMeta, trashTemplates } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import { HttpError } from '../http/validate.js';
import type { InstanceRuntime } from '../instances/runtime.js';
import { DEFAULT_BRANCH, DEFAULT_REPO, DirectorySource, GitHubSource, type GuideSource } from './source.js';

export type GuardMode = 'off' | 'notify' | 'auto' | 'strict';
export const GUARD_MODES: readonly GuardMode[] = ['off', 'notify', 'auto', 'strict'];

export interface TrashSettings {
  repo: string;
  branch: string;
  /** Hours between guide update checks. */
  refreshHours: number;
  /** Hours between guard checks. */
  guardHours: number;
  /** The guard pauses when a sync would change more objects than this. */
  maxAutoChanges: number;
  /** Syncs per instance whose backup is kept. */
  backupsPerInstance: number;
}

export const DEFAULT_SETTINGS: TrashSettings = {
  repo: DEFAULT_REPO,
  branch: DEFAULT_BRANCH,
  refreshHours: 24,
  guardHours: 6,
  maxAutoChanges: 25,
  backupsPerInstance: 20,
};

export interface GuideState {
  version: string | null;
  date: string | null;
  fetchedAt: string | null;
  checkedAt: string | null;
  error: string | null;
  source: string;
  skipped: Array<{ path: string; reason: string }>;
}

interface ChangelogEntry {
  at: string;
  from: string | null;
  to: string;
  changes: Partial<Record<TrashProduct, GuideChange[]>>;
}

type PauseReason = BrakeReason | 'pingPong';

interface AssignmentState {
  checkedAt?: string;
  error?: string | null;
  counts?: Record<ChangeOrigin, number>;
  removable?: number;
  pause?: { reasons: PauseReason[]; at: string } | null;
  lastSync?: { at: string; status: 'ok' | 'partial' | 'failed'; historyId: string; error?: string | null };
  /** Times the guard set a field back after a local change, by `key|field`. */
  reverts?: Record<string, string[]>;
}

interface Assignment {
  instanceId: string;
  templateId: string;
  guardMode: GuardMode;
  managed: ManagedIds;
  applied: AppliedState | null;
  state: AssignmentState;
  lastSyncAt: string | null;
}

interface StoredBackup {
  data: SyncBackup;
  managedBefore: ManagedIds;
  appliedBefore: AppliedState | null;
}

const CHANNEL = 'trash';
const MAX_CHANGELOG = 10;
const MAX_HISTORY_ROWS = 200;
const PING_PONG_LIMIT = 3;
const PING_PONG_WINDOW_MS = 24 * 3600_000;
const READ_CONCURRENCY = 8;

/** Turns adapter failures into a 502 the interface can explain. */
async function serviceCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AdapterError) throw new HttpError(502, 'serviceError', { kind: err.kind });
    throw err;
  }
}

function errorKind(err: unknown): string {
  if (err instanceof AdapterError) return err.kind;
  if (err instanceof HttpError) return (err.details as { kind?: string } | undefined)?.kind ?? err.code;
  return 'badResponse';
}

export const productOf = (adapterId: string): TrashProduct | null =>
  (TRASH_PRODUCTS as readonly string[]).includes(adapterId) ? (adapterId as TrashProduct) : null;

export class TrashService {
  private guideCache: Partial<Record<TrashProduct, TrashGuide>> | null = null;
  private refreshing: Promise<{ changed: boolean }> | null = null;
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly versions = new Map<string, string | null>();

  constructor(
    private readonly db: Db,
    private readonly runtime: InstanceRuntime,
    private readonly bus: EventBus,
    private readonly log: FastifyBaseLogger,
    private readonly opts: { source?: GuideSource; localDir?: string; now?: () => Date } = {},
  ) {
    runtime.registerSignalSource(CHANNEL, () => this.signals());
    runtime.onReload(() => this.reschedule());
    // A product update can change the API: check the instance again.
    runtime.onPolled((row, snapshot) => {
      const version = snapshot.connection?.version ?? null;
      const before = this.versions.get(row.id);
      this.versions.set(row.id, version);
      if (before !== undefined && before !== version && version && this.assignment(row.id)) {
        void this.check(row.id).catch(() => undefined);
      }
    });
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  // ---------------------------------------------------------------------------
  // Meta and settings

  private meta<T>(key: string, fallback: T): T {
    const row = this.db.select().from(trashMeta).where(eq(trashMeta.key, key)).get();
    return row ? (row.value as T) : fallback;
  }

  private setMeta(key: string, value: unknown): void {
    const updatedAt = this.now().toISOString();
    this.db
      .insert(trashMeta)
      .values({ key, value, updatedAt })
      .onConflictDoUpdate({ target: trashMeta.key, set: { value, updatedAt } })
      .run();
  }

  settings(): TrashSettings {
    return { ...DEFAULT_SETTINGS, ...this.meta<Partial<TrashSettings>>('settings', {}) };
  }

  saveSettings(patch: Partial<TrashSettings>): TrashSettings {
    const before = this.settings();
    const next = { ...before, ...patch };
    this.setMeta('settings', next);
    if (next.repo !== before.repo || next.branch !== before.branch) {
      // Another source: download everything again.
      this.db.delete(trashFiles).run();
      this.setMeta('guide', { ...this.guideState(), version: null });
      this.guideCache = null;
    }
    this.reschedule();
    this.publish();
    return next;
  }

  private source(): GuideSource {
    if (this.opts.source) return this.opts.source;
    if (this.opts.localDir) return new DirectorySource(this.opts.localDir);
    const s = this.settings();
    return new GitHubSource(s.repo, s.branch);
  }

  guideState(): GuideState {
    return this.meta<GuideState>('guide', {
      version: null,
      date: null,
      fetchedAt: null,
      checkedAt: null,
      error: null,
      source: this.opts.localDir ? 'directory' : 'github',
      skipped: [],
    });
  }

  // ---------------------------------------------------------------------------
  // Guide data

  guides(): Partial<Record<TrashProduct, TrashGuide>> {
    if (this.guideCache) return this.guideCache;
    const rows = this.db.select().from(trashFiles).all();
    const byProduct: Record<TrashProduct, Record<string, unknown>> = { radarr: {}, sonarr: {} };
    for (const r of rows) {
      const [product, ...rest] = r.path.split('/');
      if (product === 'radarr' || product === 'sonarr') byProduct[product][rest.join('/')] = r.content;
    }
    const out: Partial<Record<TrashProduct, TrashGuide>> = {};
    for (const product of TRASH_PRODUCTS) {
      if (Object.keys(byProduct[product]).length) out[product] = parseGuide(product, byProduct[product]);
    }
    this.guideCache = out;
    return out;
  }

  guide(product: TrashProduct): TrashGuide {
    const g = this.guides()[product];
    if (!g) throw new HttpError(409, 'guideMissing');
    return g;
  }

  /** Downloads a new guide version, if there is one. Runs once at a time. */
  refreshGuide(): Promise<{ changed: boolean }> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<{ changed: boolean }> {
    const state = this.guideState();
    const source = this.source();
    const at = this.now().toISOString();
    try {
      const listing = await source.list();
      if (listing.version === state.version) {
        this.setMeta('guide', { ...state, checkedAt: at, error: null, source: source.label });
        this.publish();
        return { changed: false };
      }
      const stored = new Map(
        this.db
          .select({ path: trashFiles.path, sha: trashFiles.sha })
          .from(trashFiles)
          .all()
          .map((r) => [r.path, r.sha]),
      );
      const todo = listing.files.filter((f) => stored.get(f.path) !== f.sha);
      const fetched: Array<{ path: string; sha: string; content: unknown }> = [];
      for (let i = 0; i < todo.length; i += READ_CONCURRENCY) {
        const batch = todo.slice(i, i + READ_CONCURRENCY);
        const contents = await Promise.all(batch.map((f) => source.read(f, listing.version)));
        batch.forEach((f, j) => fetched.push({ path: f.path, sha: f.sha, content: contents[j] }));
      }
      const before = this.guides();
      const keep = listing.files.map((f) => f.path);
      this.db.transaction((tx) => {
        if (keep.length) tx.delete(trashFiles).where(notInArray(trashFiles.path, keep)).run();
        else tx.delete(trashFiles).run();
        for (const f of fetched) {
          tx.insert(trashFiles)
            .values(f)
            .onConflictDoUpdate({ target: trashFiles.path, set: { sha: f.sha, content: f.content } })
            .run();
        }
      });
      this.guideCache = null;
      const after = this.guides();
      const skipped = TRASH_PRODUCTS.flatMap((p) =>
        (after[p]?.skipped ?? []).map((s) => ({ ...s, path: `${p}/${s.path}` })),
      );
      if (state.version) {
        const changes: ChangelogEntry['changes'] = {};
        for (const p of TRASH_PRODUCTS) {
          const a = before[p];
          const b = after[p];
          if (a && b) {
            const list = diffGuides(a, b);
            if (list.length) changes[p] = list;
          }
        }
        if (Object.keys(changes).length) {
          const log = this.meta<ChangelogEntry[]>('changelog', []);
          log.unshift({ at, from: state.version, to: listing.version, changes });
          this.setMeta('changelog', log.slice(0, MAX_CHANGELOG));
        }
      }
      this.setMeta('guide', {
        version: listing.version,
        date: listing.date,
        fetchedAt: at,
        checkedAt: at,
        error: null,
        source: source.label,
        skipped,
      } satisfies GuideState);
      this.publish();
      // New guide data: check every instance with a template.
      void this.checkAll().catch(() => undefined);
      return { changed: true };
    } catch (err) {
      this.log.warn({ err: err instanceof Error ? err.message : String(err) }, 'TRaSH Guides update failed');
      this.setMeta('guide', { ...state, checkedAt: at, error: 'fetchFailed', source: source.label });
      this.runtime.refreshIssues();
      this.publish();
      throw new HttpError(502, 'guideFetchFailed');
    }
  }

  /** Downloads the guide on first use. */
  async ensureGuide(): Promise<void> {
    if (!this.guideState().version) await this.refreshGuide();
  }

  changelog(): ChangelogEntry[] {
    return this.meta<ChangelogEntry[]>('changelog', []);
  }

  /** What the template editor needs from the guide of one product. */
  catalog(product: TrashProduct) {
    const g = this.guide(product);
    const profiles = Object.values(g.profiles)
      .filter((p) => !p.hidden)
      .sort((a, b) => a.group - b.group || a.name.localeCompare(b.name))
      .map((p) => ({
        trashId: p.trashId,
        name: p.name,
        description: p.description,
        url: p.url ?? null,
        category: p.category,
        scoreSet: p.scoreSet,
        qualitySize: p.qualitySize ?? null,
        formats: p.formats,
        groups: groupsForProfile(g, p.trashId).map((x) => x.trashId),
        suggested: suggestedTemplateProfile(g, p.trashId),
        cutoff: p.cutoff,
        qualities: p.items,
      }));
    return {
      product,
      categories: profileCategories(g),
      profiles,
      groups: Object.values(g.cfGroups)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((x) => ({
          trashId: x.trashId,
          name: x.name,
          description: x.description,
          recommended: x.recommended,
          formats: x.formats,
        })),
      customFormats: Object.values(g.customFormats)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((cf) => ({
          trashId: cf.trashId,
          name: cf.name,
          scores: cf.scores,
          description: cf.description ?? null,
        })),
      qualitySizes: Object.values(g.qualitySizes).map((s) => ({ trashId: s.trashId, type: s.type })),
      naming: Object.fromEntries(
        Object.entries(g.naming).filter(([setting]) => setting in NAMING_FIELDS[product]),
      ),
      conflicts: g.conflicts,
    };
  }

  // ---------------------------------------------------------------------------
  // Templates

  templates() {
    return this.db
      .select()
      .from(trashTemplates)
      .orderBy(trashTemplates.name)
      .all()
      .map((t) => ({ ...t, config: t.config as unknown as TemplateConfig }));
  }

  template(id: string) {
    const t = this.templates().find((x) => x.id === id);
    if (!t) throw new HttpError(404, 'notFound');
    return t;
  }

  saveTemplate(input: { id?: string; name: string; product: TrashProduct; config: TemplateConfig }) {
    const clash = this.templates().find(
      (t) => t.name.toLowerCase() === input.name.toLowerCase() && t.id !== input.id,
    );
    if (clash) throw new HttpError(409, 'nameTaken');
    const at = this.now().toISOString();
    const config = input.config as unknown as Record<string, unknown>;
    if (input.id) {
      const existing = this.template(input.id);
      if (existing.product !== input.product) throw new HttpError(400, 'productFixed');
      this.db
        .update(trashTemplates)
        .set({ name: input.name, config, updatedAt: at })
        .where(eq(trashTemplates.id, input.id))
        .run();
    } else {
      input.id = newId();
      this.db
        .insert(trashTemplates)
        .values({
          id: input.id,
          name: input.name,
          product: input.product,
          config,
          createdAt: at,
          updatedAt: at,
        })
        .run();
    }
    this.publish();
    // Instances with this template now differ from it: check them.
    for (const a of this.assignments().filter((x) => x.templateId === input.id))
      void this.check(a.instanceId).catch(() => undefined);
    return this.template(input.id);
  }

  deleteTemplate(id: string): void {
    this.template(id);
    if (this.assignments().some((a) => a.templateId === id)) throw new HttpError(409, 'templateInUse');
    this.db.delete(trashTemplates).where(eq(trashTemplates.id, id)).run();
    this.publish();
  }

  /** Resolves a template against the current guide, without an instance. */
  resolve(product: TrashProduct, config: TemplateConfig): DesiredState {
    return resolveTemplate(this.guide(product), config);
  }

  /** The editor summary: formats and scores per profile, and warnings. */
  explain(product: TrashProduct, config: TemplateConfig) {
    const g = this.guide(product);
    const desired = resolveTemplate(g, config);
    const groupOf = new Map<string, string>();
    const profiles = config.profiles.map((tp) => {
      const p = g.profiles[tp.trashId];
      for (const gid of tp.groups)
        for (const f of g.cfGroups[gid]?.formats ?? []) groupOf.set(f.trashId, g.cfGroups[gid]!.name);
      const own = new Set(p?.formats ?? []);
      const extra = new Set(tp.extraFormats);
      const scoreSet = tp.scoreSet ?? p?.scoreSet ?? 'default';
      return {
        trashId: tp.trashId,
        name: tp.name?.trim() || p?.name || tp.trashId,
        scoreSet,
        formats: profileFormats(g, tp)
          .map((id) => g.customFormats[id])
          .filter((cf): cf is NonNullable<typeof cf> => !!cf)
          .map((cf) => ({
            trashId: cf.trashId,
            name: cf.name,
            guideScore: scoreFor(cf, scoreSet),
            score: scoreFor(cf, scoreSet, tp.scoreOverrides[cf.trashId]),
            source: own.has(cf.trashId) ? 'profile' : extra.has(cf.trashId) ? 'extra' : 'group',
            group: own.has(cf.trashId) || extra.has(cf.trashId) ? null : (groupOf.get(cf.trashId) ?? null),
          }))
          .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
      };
    });
    return {
      warnings: desired.warnings,
      profiles,
      counts: {
        customFormats: desired.objects.filter((o) => o.kind === 'customFormat').length,
        qualityProfiles: desired.objects.filter((o) => o.kind === 'qualityProfile').length,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Instances and assignments

  eligible() {
    return this.runtime
      .snapshots()
      .filter(({ row, def }) => row.enabled && def.capabilities.includes('trashSync') && productOf(def.id));
  }

  private known(instanceId: string) {
    const found = this.eligible().find((e) => e.row.id === instanceId);
    const entry = this.runtime.adapter(instanceId);
    const api = entry?.adapter.profileSync;
    if (!found || !entry || !api) throw new HttpError(404, 'notFound');
    return { ...found, entry, api, product: productOf(found.def.id)! };
  }

  private assignments(): Assignment[] {
    return this.db
      .select()
      .from(trashAssignments)
      .all()
      .map((r) => ({
        instanceId: r.instanceId,
        templateId: r.templateId,
        guardMode: r.guardMode,
        managed: r.managed,
        applied: r.applied ?? null,
        state: r.state as AssignmentState,
        lastSyncAt: r.lastSyncAt,
      }));
  }

  private assignment(instanceId: string): Assignment | undefined {
    return this.assignments().find((a) => a.instanceId === instanceId);
  }

  private updateAssignment(instanceId: string, patch: Partial<Omit<Assignment, 'instanceId'>>): void {
    const set: Record<string, unknown> = { ...patch, updatedAt: this.now().toISOString() };
    this.db.update(trashAssignments).set(set).where(eq(trashAssignments.instanceId, instanceId)).run();
  }

  instances() {
    const assignments = new Map(this.assignments().map((a) => [a.instanceId, a]));
    const templates = new Map(this.templates().map((t) => [t.id, t]));
    return this.eligible().map(({ row, def, snapshot }) => {
      const a = assignments.get(row.id);
      return {
        id: row.id,
        name: row.name,
        adapter: def.id,
        product: productOf(def.id)!,
        version: snapshot.connection?.version ?? null,
        status: snapshot.status,
        templateId: a?.templateId ?? null,
        templateName: a ? (templates.get(a.templateId)?.name ?? null) : null,
        guardMode: a?.guardMode ?? 'off',
        lastSyncAt: a?.lastSyncAt ?? null,
        neverSynced: a ? a.applied === null : false,
        state: a?.state ?? {},
      };
    });
  }

  assign(instanceId: string, templateId: string | null): void {
    const { product } = this.known(instanceId);
    if (templateId === null) {
      this.db.delete(trashAssignments).where(eq(trashAssignments.instanceId, instanceId)).run();
      this.runtime.refreshIssues();
      this.publish();
      return;
    }
    const t = this.template(templateId);
    if (t.product !== product) throw new HttpError(400, 'wrongProduct');
    const existing = this.assignment(instanceId);
    if (existing) {
      // A new template is a new plan: the guard waits for a confirmed sync.
      this.updateAssignment(instanceId, {
        templateId,
        guardMode: existing.guardMode === 'off' ? 'off' : 'notify',
        state: { ...existing.state, pause: null },
      });
    } else {
      this.db
        .insert(trashAssignments)
        .values({ instanceId, templateId, guardMode: 'notify', managed: {}, state: {} })
        .run();
    }
    this.publish();
    void this.check(instanceId).catch(() => undefined);
  }

  /** Auto modes change settings without asking, so they need a confirmation. */
  setGuard(instanceId: string, mode: GuardMode, confirmed: boolean): void {
    this.known(instanceId);
    const a = this.assignment(instanceId);
    if (!a) throw new HttpError(409, 'noTemplate');
    if ((mode === 'auto' || mode === 'strict') && !confirmed)
      throw new HttpError(400, 'confirmationRequired');
    if ((mode === 'auto' || mode === 'strict') && a.applied === null) throw new HttpError(409, 'syncFirst');
    this.updateAssignment(instanceId, { guardMode: mode, state: { ...a.state, pause: null, reverts: {} } });
    this.publish();
    void this.check(instanceId).catch(() => undefined);
  }

  // ---------------------------------------------------------------------------
  // Plans, syncs and rollbacks

  private async withLock<T>(instanceId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(instanceId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
    this.locks.set(instanceId, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(instanceId) === run) this.locks.delete(instanceId);
    }
  }

  private async readSnapshot(
    api: ProfileSyncApi,
    gate: { run<T>(fn: () => Promise<T>): Promise<T> },
  ): Promise<ArrSnapshot> {
    return serviceCall(() =>
      gate.run(async () => {
        await api.ensureSupported();
        const [customFormats, qualityProfiles, qualityDefinitions, naming, languages] = await Promise.all([
          api.customFormats(),
          api.qualityProfiles(),
          api.qualityDefinitions(),
          api.naming(),
          api.languages().catch(() => []),
        ]);
        return { customFormats, qualityProfiles, qualityDefinitions, naming, languages };
      }),
    );
  }

  private async planFor(instanceId: string) {
    const k = this.known(instanceId);
    const a = this.assignment(instanceId);
    if (!a) throw new HttpError(409, 'noTemplate');
    await this.ensureGuide();
    const t = this.template(a.templateId);
    const desired = this.resolve(k.product, t.config);
    const snap = await this.readSnapshot(k.api, k.entry.gate);
    const plan = buildPlan(desired, snap, a.managed, a.applied);
    return { k, a, t, desired, plan };
  }

  async preview(instanceId: string) {
    const { plan, a, t } = await this.planFor(instanceId);
    return {
      template: { id: t.id, name: t.name },
      neverSynced: a.applied === null,
      plan,
      brakes: brakesFor(plan, this.settings().maxAutoChanges),
    };
  }

  /** A sync the admin confirmed after the preview. Applies every change. */
  async sync(instanceId: string, opts: { removals: boolean; actor: string }) {
    return this.withLock(instanceId, async () => {
      const ctx = await this.planFor(instanceId);
      const done = filterPlan(ctx.plan, ['initial', 'guide', 'local'], opts.removals);
      const entry = await this.execute(ctx, done, opts.actor, opts.removals);
      const a = this.assignment(instanceId)!;
      // A confirmed sync ends a pause of the guard.
      this.updateAssignment(instanceId, { state: { ...a.state, pause: null } });
      await this.check(instanceId, { lock: false }).catch(() => undefined);
      return entry;
    });
  }

  private async execute(
    ctx: Awaited<ReturnType<TrashService['planFor']>>,
    done: SyncPlan,
    actor: string,
    removals: boolean,
  ) {
    const { k, a, t, desired, plan } = ctx;
    const result = await serviceCall(() =>
      k.entry.gate.run(() => executeSyncPlan(k.api, done, a.managed, { removals })),
    );
    const at = this.now().toISOString();
    const status: 'ok' | 'partial' | 'failed' = !result.error
      ? 'ok'
      : result.applied > 0
        ? 'partial'
        : 'failed';
    const id = newId();
    const backup: StoredBackup = { data: result.backup, managedBefore: a.managed, appliedBefore: a.applied };
    const changed = done.objects.filter((o) => o.action !== 'unchanged');
    this.db
      .insert(trashHistory)
      .values({
        id,
        instanceId: k.row.id,
        templateName: t.name,
        at,
        actor,
        kind: 'sync',
        status,
        summary: {
          counts: done.counts,
          objects: changed.map((o) => ({
            kind: o.kind,
            label: o.label,
            action: o.action,
            fields: o.changes.length,
          })),
          warnings: result.warnings,
          guide: this.guideState().version,
        },
        backup: result.applied > 0 ? (backup as unknown as Record<string, unknown>) : null,
        error: result.error ? `${result.error.key}: ${result.error.message}` : null,
      })
      .run();
    const applied = status === 'ok' ? mergeApplied(a.applied, desired, plan, done) : a.applied;
    this.updateAssignment(k.row.id, {
      managed: result.managed,
      applied,
      lastSyncAt: result.applied > 0 ? at : a.lastSyncAt,
      state: {
        ...(this.assignment(k.row.id)?.state ?? a.state),
        lastSync: { at, status, historyId: id, error: result.error?.message ?? null },
      },
    });
    this.pruneBackups(k.row.id);
    this.publish();
    return this.historyEntry(id);
  }

  private pruneBackups(instanceId: string): void {
    const keep = this.settings().backupsPerInstance;
    const rows = this.db
      .select({ id: trashHistory.id })
      .from(trashHistory)
      .where(and(eq(trashHistory.instanceId, instanceId), isNotNull(trashHistory.backup)))
      .orderBy(desc(trashHistory.at))
      .all();
    for (const r of rows.slice(keep)) {
      this.db.update(trashHistory).set({ backup: null }).where(eq(trashHistory.id, r.id)).run();
    }
    const all = this.db
      .select({ at: trashHistory.at })
      .from(trashHistory)
      .where(eq(trashHistory.instanceId, instanceId))
      .orderBy(desc(trashHistory.at))
      .all();
    const cutoff = all[MAX_HISTORY_ROWS - 1]?.at;
    if (cutoff)
      this.db
        .delete(trashHistory)
        .where(and(eq(trashHistory.instanceId, instanceId), lt(trashHistory.at, cutoff)))
        .run();
  }

  async rollback(historyId: string, actor: string) {
    const row = this.db.select().from(trashHistory).where(eq(trashHistory.id, historyId)).get();
    if (!row || row.kind !== 'sync') throw new HttpError(404, 'notFound');
    if (!row.backup) throw new HttpError(409, 'noBackup');
    if (row.rolledBackAt) throw new HttpError(409, 'alreadyRolledBack');
    const k = this.known(row.instanceId);
    return this.withLock(row.instanceId, async () => {
      const stored = row.backup as unknown as StoredBackup;
      const result = await serviceCall(() => k.entry.gate.run(() => restoreBackup(k.api, stored.data)));
      const at = this.now().toISOString();
      const status = result.errors.length === 0 ? 'ok' : result.restored > 0 ? 'partial' : 'failed';
      const id = newId();
      this.db
        .insert(trashHistory)
        .values({
          id,
          instanceId: row.instanceId,
          templateName: row.templateName,
          at,
          actor,
          kind: 'rollback',
          status,
          summary: { of: historyId, restored: result.restored, errors: result.errors },
          backup: null,
          error: result.errors.map((e) => `${e.what}: ${e.message}`).join('; ') || null,
        })
        .run();
      this.db.update(trashHistory).set({ rolledBackAt: at }).where(eq(trashHistory.id, historyId)).run();
      const a = this.assignment(row.instanceId);
      if (a) {
        // The instance is back on the old state on purpose: the guard only reports from now on.
        this.updateAssignment(row.instanceId, {
          managed: stored.managedBefore,
          applied: stored.appliedBefore,
          guardMode: a.guardMode === 'off' ? 'off' : 'notify',
          state: { ...a.state, pause: null, reverts: {} },
        });
      }
      this.publish();
      await this.check(row.instanceId, { lock: false }).catch(() => undefined);
      return this.historyEntry(id);
    });
  }

  private historyEntry(id: string) {
    const r = this.db.select().from(trashHistory).where(eq(trashHistory.id, id)).get()!;
    const { backup, ...rest } = r;
    return { ...rest, hasBackup: !!backup };
  }

  history(filter: { instanceId?: string; limit: number }) {
    const rows = this.db
      .select()
      .from(trashHistory)
      .where(filter.instanceId ? eq(trashHistory.instanceId, filter.instanceId) : undefined)
      .orderBy(desc(trashHistory.at))
      .limit(filter.limit)
      .all();
    const names = new Map(this.runtime.snapshots().map((s) => [s.row.id, s.row.name]));
    return rows.map(({ backup, ...rest }) => ({
      ...rest,
      instanceName: names.get(rest.instanceId) ?? null,
      hasBackup: !!backup,
    }));
  }

  // ---------------------------------------------------------------------------
  // Guard

  private reschedule(): void {
    const scheduler = this.runtime.schedulerRef;
    if (!scheduler) return;
    const s = this.settings();
    scheduler.schedule(
      'trash:guide',
      s.refreshHours * 3600_000,
      async () => {
        if (this.assignments().length) await this.refreshGuide().catch(() => undefined);
      },
      5 * 60_000,
    );
    scheduler.schedule('trash:guard', s.guardHours * 3600_000, () => this.checkAll(), 3 * 60_000);
  }

  async checkAll(): Promise<void> {
    const eligible = new Set(this.eligible().map((e) => e.row.id));
    for (const a of this.assignments()) {
      if (eligible.has(a.instanceId)) await this.check(a.instanceId).catch(() => undefined);
    }
  }

  /** Compares the instance with its template and acts on the guard mode. */
  async check(instanceId: string, opts: { lock?: boolean } = {}): Promise<void> {
    const run = async () => {
      const a = this.assignment(instanceId);
      if (!a || a.guardMode === 'off') {
        if (a) this.updateAssignment(instanceId, { state: { ...a.state, counts: undefined, error: null } });
        this.runtime.refreshIssues();
        return;
      }
      const at = this.now().toISOString();
      let ctx: Awaited<ReturnType<TrashService['planFor']>>;
      try {
        ctx = await this.planFor(instanceId);
      } catch (err) {
        this.updateAssignment(instanceId, { state: { ...a.state, checkedAt: at, error: errorKind(err) } });
        this.runtime.refreshIssues();
        this.publish();
        return;
      }
      let state: AssignmentState = { ...a.state, checkedAt: at, error: null };
      const auto = a.guardMode === 'auto' || a.guardMode === 'strict';
      if (auto && a.applied !== null && !state.pause) {
        const origins: ChangeOrigin[] = a.guardMode === 'strict' ? ['guide', 'local'] : ['guide'];
        const todo = filterPlan(ctx.plan, origins);
        if (todo.counts.create + todo.counts.update > 0) {
          const reasons: PauseReason[] = brakesFor(todo, this.settings().maxAutoChanges);
          const reverts = this.trackReverts(state.reverts ?? {}, todo);
          if (Object.values(reverts).some((times) => times.length >= PING_PONG_LIMIT))
            reasons.push('pingPong');
          if (reasons.length) {
            state = { ...state, pause: { reasons, at }, reverts };
          } else {
            this.updateAssignment(instanceId, { state: { ...state, reverts } });
            await this.execute(ctx, todo, 'guard', false);
            const after = await this.planFor(instanceId).catch(() => null);
            if (after) ctx = after;
            state = { ...this.assignment(instanceId)!.state, checkedAt: at, error: null };
          }
        }
      }
      const counts: Record<ChangeOrigin, number> = { guide: 0, local: 0, initial: 0 };
      for (const o of ctx.plan.objects) {
        if (o.action === 'create') counts[ctx.a.applied ? 'guide' : 'initial']++;
        else {
          const origins = new Set(o.changes.map((c) => c.origin));
          for (const origin of origins) counts[origin]++;
        }
      }
      state = { ...state, counts, removable: ctx.plan.counts.remove };
      this.updateAssignment(instanceId, { state });
      this.runtime.refreshIssues();
      this.publish();
    };
    return opts.lock === false ? run() : this.withLock(instanceId, run);
  }

  private trackReverts(previous: Record<string, string[]>, plan: SyncPlan): Record<string, string[]> {
    const now = this.now().getTime();
    const out: Record<string, string[]> = {};
    for (const [key, times] of Object.entries(previous)) {
      const recent = times.filter((t) => now - Date.parse(t) < PING_PONG_WINDOW_MS);
      if (recent.length) out[key] = recent;
    }
    for (const o of plan.objects) {
      for (const c of o.changes) {
        if (c.origin !== 'local') continue;
        const key = `${o.key}|${c.field}`;
        out[key] = [...(out[key] ?? []), new Date(now).toISOString()];
      }
    }
    return out;
  }

  resume(instanceId: string): void {
    this.known(instanceId);
    const a = this.assignment(instanceId);
    if (!a) throw new HttpError(409, 'noTemplate');
    this.updateAssignment(instanceId, { state: { ...a.state, pause: null, reverts: {} } });
    this.publish();
    void this.check(instanceId).catch(() => undefined);
  }

  private signals(): { signals: Signal[]; checked: string[] } {
    const signals: Signal[] = [];
    const checked: string[] = [];
    const guide = this.guideState();
    const assignments = new Map(this.assignments().map((a) => [a.instanceId, a]));
    const templates = new Map(this.templates().map((t) => [t.id, t.name]));
    for (const { row, def } of this.eligible()) {
      const instance = { id: row.id, name: row.name, adapter: def.id };
      const key = sourceKey('wardarr', row.id, CHANNEL);
      checked.push(key);
      const a = assignments.get(row.id);
      if (!a || a.guardMode === 'off') continue;
      const base = { origin: 'wardarr' as const, instance, kind: 'trash' as const, channel: CHANNEL };
      const template = templates.get(a.templateId) ?? '';
      if (guide.error) {
        signals.push({ ...base, source: 'Trash.guideFetchFailed', level: 'info', message: guide.error });
      }
      const s = a.state;
      if (s.error === 'unsupported') {
        signals.push({ ...base, source: 'Trash.unsupportedVersion', level: 'info', message: 'unsupported' });
        continue;
      }
      if (s.counts?.guide) {
        signals.push({
          ...base,
          source: 'Trash.guideDrift',
          level: 'info',
          message: String(s.counts.guide),
          data: { count: s.counts.guide, template },
        });
      }
      if (s.counts?.local) {
        signals.push({
          ...base,
          source: 'Trash.localDrift',
          level: 'info',
          message: String(s.counts.local),
          data: { count: s.counts.local, template },
        });
      }
      if (s.pause) {
        signals.push({
          ...base,
          source: 'Trash.syncPaused',
          level: 'warning',
          message: s.pause.reasons.join(','),
          data: { reason: s.pause.reasons[0] ?? 'manyChanges' },
        });
      }
      if (s.lastSync && s.lastSync.status !== 'ok') {
        signals.push({
          ...base,
          source: 'Trash.syncFailed',
          level: 'warning',
          message: s.lastSync.error ?? '',
          data: { historyId: s.lastSync.historyId },
        });
      }
    }
    return { signals, checked };
  }

  // ---------------------------------------------------------------------------
  // Release test and existing setups

  async releaseTest(instanceId: string, title: string) {
    const k = this.known(instanceId);
    const [parsed, profiles] = await serviceCall(() =>
      k.entry.gate.run(async () => {
        await k.api.ensureSupported();
        return Promise.all([k.api.parseRelease(title), k.api.qualityProfiles()]);
      }),
    );
    const managed = new Set(
      Object.entries(this.assignment(instanceId)?.managed ?? {})
        .filter(([key]) => key.startsWith('qp:'))
        .map(([, id]) => id),
    );
    return {
      parsed,
      profiles: profiles
        .map((p) => ({ id: p.id, name: p.name, managed: managed.has(p.id), ...releaseScore(parsed, p) }))
        .sort((a, b) => Number(b.managed) - Number(a.managed) || a.name.localeCompare(b.name)),
    };
  }

  /**
   * Reads an instance and suggests a template that matches what it already
   * has, so a setup made by hand or by another tool can be taken over.
   */
  async suggestFromInstance(instanceId: string) {
    const k = this.known(instanceId);
    await this.ensureGuide();
    const g = this.guide(k.product);
    const snap = await this.readSnapshot(k.api, k.entry.gate);
    const cfByName = new Map(Object.values(g.customFormats).map((cf) => [cf.name.toLowerCase(), cf]));
    const arrNames = new Map(snap.customFormats.map((c) => [c.id, c.name.toLowerCase()]));
    const profiles: TemplateProfile[] = [];
    const matches: Array<{
      arrProfile: string;
      trashProfile: string;
      match: 'name' | 'formats';
      similarity: number;
    }> = [];
    const candidates = Object.values(g.profiles).filter((p) => !p.hidden);

    for (const p of snap.qualityProfiles) {
      const scored = new Map<string, number>();
      for (const fi of p.formatItems) {
        if (!fi.score) continue;
        const cf = cfByName.get(arrNames.get(fi.format) ?? '');
        if (cf) scored.set(cf.trashId, fi.score);
      }
      let best = candidates.find((c) => c.name.toLowerCase() === p.name.toLowerCase());
      let similarity = 1;
      let how: 'name' | 'formats' = 'name';
      if (!best) {
        how = 'formats';
        similarity = 0;
        for (const c of candidates) {
          const set = new Set(suggestedProfileFormats(g, c.trashId));
          const inter = [...scored.keys()].filter((id) => set.has(id)).length;
          const union = new Set([...set, ...scored.keys()]).size || 1;
          if (inter / union > similarity) {
            similarity = inter / union;
            best = c;
          }
        }
        if (!best || similarity < 0.5) continue;
      }
      const groups = groupsForProfile(g, best.trashId)
        .filter((grp) => grp.formats.some((f) => scored.has(f.trashId) && !best.formats.includes(f.trashId)))
        .map((grp) => grp.trashId);
      const tp: TemplateProfile = {
        trashId: best.trashId,
        name: p.name,
        groups,
        excludedFormats: [],
        extraFormats: [],
        scoreOverrides: {},
      };
      const covered = new Set<string>(best.formats);
      for (const gid of groups) {
        for (const f of g.cfGroups[gid]!.formats) {
          if (f.required || f.preselected) {
            if (!f.required && !scored.has(f.trashId)) tp.excludedFormats.push(f.trashId);
            else covered.add(f.trashId);
          }
        }
      }
      for (const id of scored.keys()) if (!covered.has(id)) tp.extraFormats.push(id);
      for (const [id, score] of scored) {
        const cf = g.customFormats[id]!;
        const guideScore = cf.scores[best.scoreSet] ?? cf.scores.default ?? 0;
        if (score !== guideScore) tp.scoreOverrides[id] = score;
      }
      profiles.push(tp);
      matches.push({
        arrProfile: p.name,
        trashProfile: best.name,
        match: how,
        similarity: Math.round(similarity * 100) / 100,
      });
    }

    let qualitySize: string | null = null;
    let bestHits = 0;
    for (const size of Object.values(g.qualitySizes)) {
      const hits = size.qualities.filter((q) => {
        const d = snap.qualityDefinitions.find((x) => x.quality.name === q.quality);
        return d && sameValue(d.minSize, q.min) && sameValue(d.maxSize, q.max);
      }).length;
      if (hits > bestHits && hits >= size.qualities.length / 2) {
        bestHits = hits;
        qualitySize = size.trashId;
      }
    }
    const naming: Record<string, string> = {};
    for (const [setting, field] of Object.entries(NAMING_FIELDS[k.product])) {
      const variants = g.naming[setting] ?? {};
      const hit = Object.entries(variants).find(([, v]) => v === snap.naming[field]);
      if (hit) naming[setting] = hit[0];
    }
    const config: TemplateConfig = { profiles, qualitySize, naming, rename: false };
    return { product: k.product, config, matches };
  }

  private publish(): void {
    this.bus.publish({ type: 'trash.updated', audience: 'admin' });
  }
}

/** Formats of a profile with its recommended groups, for similarity checks. */
function suggestedProfileFormats(g: TrashGuide, profileId: string): string[] {
  const tp = suggestedTemplateProfile(g, profileId);
  const p = g.profiles[profileId]!;
  const ids = new Set(p.formats);
  for (const gid of tp.groups)
    for (const f of g.cfGroups[gid]?.formats ?? []) if (f.preselected) ids.add(f.trashId);
  return [...ids];
}
