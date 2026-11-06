// Applies a sync plan to an instance and restores backups. Before anything is
// changed, the affected objects are saved so a sync can be undone. The run
// stops at the first failure; what was changed until then is in the backup.
import type {
  ArrCustomFormat,
  ArrCustomFormatBase,
  ArrQualityProfileBase,
  ArrNaming,
  ArrProfileItem,
  ArrQuality,
  ArrQualityDefinition,
  ArrQualityProfile,
  ArrLanguage,
  FieldChange,
  ManagedIds,
  ObjectPlan,
  ProfileSyncApi,
  SyncPlan,
  TrashQualityItem,
  TrashSpecification,
} from './types.js';

export interface SyncBackup {
  /** Previous versions of updated and removed custom formats. */
  customFormats: ArrCustomFormat[];
  /** Previous versions of updated quality profiles. */
  qualityProfiles: ArrQualityProfile[];
  /** Previous versions of changed quality definitions. */
  qualityDefinitions: ArrQualityDefinition[];
  naming: ArrNaming | null;
  /** Objects the sync created, removed again on rollback. */
  created: { customFormats: number[]; qualityProfiles: number[] };
}

export interface ExecuteResult {
  managed: ManagedIds;
  backup: SyncBackup;
  /** Objects created, updated or removed. */
  applied: number;
  error: { key: string; message: string } | null;
  warnings: Array<{ code: 'unknownQuality'; params: Record<string, string> }>;
}

const emptyBackup = (): SyncBackup => ({
  customFormats: [],
  qualityProfiles: [],
  qualityDefinitions: [],
  naming: null,
  created: { customFormats: [], qualityProfiles: [] },
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function toArrSpecs(specs: TrashSpecification[]) {
  return specs.map((s) => ({
    name: s.name,
    implementation: s.implementation,
    negate: s.negate,
    required: s.required,
    fields: Object.entries(s.fields).map(([name, value]) => ({ name, value })),
  }));
}

export function applyCustomFormatChanges<T extends ArrCustomFormatBase>(base: T, changes: FieldChange[]): T {
  const out = clone(base);
  for (const c of changes) {
    if (c.field === 'name') out.name = String(c.after);
    else if (c.field === 'includeCustomFormatWhenRenaming') out.includeCustomFormatWhenRenaming = !!c.after;
    else if (c.field === 'specifications') out.specifications = toArrSpecs(c.after as TrashSpecification[]);
  }
  return out;
}

/** Builds *arr profile items from guide items (best first). Unknown qualities are reported. */
export function buildProfileItems(
  qualities: TrashQualityItem[],
  definitions: ArrQualityDefinition[],
  unknown: string[] = [],
): ArrProfileItem[] {
  const byName = new Map<string, ArrQuality>(definitions.map((d) => [d.quality.name, d.quality]));
  const used = new Set<string>();
  const out: ArrProfileItem[] = [];
  let groupId = 1000;
  const leaf = (name: string, allowed: boolean): ArrProfileItem | null => {
    const q = byName.get(name);
    if (!q) {
      unknown.push(name);
      return null;
    }
    used.add(name);
    return { quality: q, items: [], allowed };
  };
  for (const item of qualities) {
    if (item.items?.length) {
      const members = item.items.map((n) => leaf(n, item.allowed)).filter((x): x is ArrProfileItem => !!x);
      if (members.length) out.push({ id: groupId++, name: item.name, items: members, allowed: item.allowed });
    } else {
      const l = leaf(item.name, item.allowed);
      if (l) out.push(l);
    }
  }
  for (const d of definitions)
    if (!used.has(d.quality.name)) out.push({ quality: d.quality, items: [], allowed: false });
  return out.reverse();
}

function cutoffId(items: ArrProfileItem[], name: string): number | undefined {
  for (const i of items) {
    if (i.quality && i.quality.name === name) return i.quality.id;
    if (!i.quality && i.name === name) return i.id;
  }
  return undefined;
}

export function applyProfileChanges<T extends ArrQualityProfileBase>(
  base: T,
  changes: FieldChange[],
  ctx: {
    formatIds: Map<string, number>;
    definitions: ArrQualityDefinition[];
    languages: ArrLanguage[];
    unknown?: string[];
  },
): T {
  const out = clone(base);
  let cutoff: string | undefined;
  for (const c of changes) {
    if (c.field.startsWith('score:')) {
      const arrId = ctx.formatIds.get(c.field.slice('score:'.length));
      if (arrId === undefined) continue;
      const item = out.formatItems.find((f) => f.format === arrId);
      if (item) item.score = Number(c.after);
      else out.formatItems.push({ format: arrId, score: Number(c.after) });
    } else if (c.field === 'qualities') {
      out.items = buildProfileItems(c.after as TrashQualityItem[], ctx.definitions, ctx.unknown);
    } else if (c.field === 'cutoff') {
      cutoff = String(c.after);
    } else if (c.field === 'language') {
      const lang = ctx.languages.find((l) => l.name.toLowerCase() === String(c.after).toLowerCase());
      if (lang) out.language = { id: lang.id, name: lang.name };
    } else {
      (out as Record<string, unknown>)[c.field] = c.after;
    }
  }
  if (cutoff !== undefined) {
    const id = cutoffId(out.items, cutoff);
    if (id !== undefined) out.cutoff = id;
  }
  return out;
}

export function applyQualitySizeChanges(
  defs: ArrQualityDefinition[],
  changes: FieldChange[],
): ArrQualityDefinition[] {
  const out: ArrQualityDefinition[] = [];
  for (const c of changes) {
    const def = defs.find((d) => d.quality.name === c.field);
    const v = c.after as { min: number; preferred: number; max: number };
    if (!def || !v) continue;
    out.push({ ...clone(def), minSize: v.min, preferredSize: v.preferred, maxSize: v.max });
  }
  return out;
}

const pending = (o: ObjectPlan) =>
  o.action === 'create' || o.action === 'remove' || (o.action === 'update' && o.changes.length > 0);

/** Applies the plan. `removals` must be true for planned removals to run. */
export async function executeSyncPlan(
  api: ProfileSyncApi,
  plan: SyncPlan,
  managedBefore: ManagedIds,
  opts: { removals?: boolean } = {},
): Promise<ExecuteResult> {
  const backup = emptyBackup();
  const managed: ManagedIds = { ...managedBefore };
  const warnings: ExecuteResult['warnings'] = [];
  let applied = 0;
  let current = '';
  const work = plan.objects.filter(pending);
  if (!work.length) return { managed, backup, applied, error: null, warnings };

  try {
    // Custom formats first: profiles need their ids.
    const formats = await api.customFormats();
    const formatIds = new Map<string, number>();
    for (const [key, id] of Object.entries(managed))
      if (key.startsWith('cf:')) formatIds.set(key.slice(3), id);
    for (const o of plan.objects.filter((x) => x.kind === 'customFormat' && x.arrId !== undefined)) {
      formatIds.set(o.key.slice(3), o.arrId!);
      if (o.action !== 'remove') managed[o.key] = o.arrId!;
    }

    for (const o of work.filter((x) => x.kind === 'customFormat')) {
      current = o.key;
      if (o.action === 'create') {
        const created = await api.createCustomFormat(
          applyCustomFormatChanges(
            { name: '', includeCustomFormatWhenRenaming: false, specifications: [] },
            o.changes,
          ),
        );
        backup.created.customFormats.push(created.id);
        managed[o.key] = created.id;
        formatIds.set(o.key.slice(3), created.id);
      } else if (o.action === 'update') {
        const existing = formats.find((f) => f.id === o.arrId);
        if (!existing) throw new Error('custom format disappeared');
        backup.customFormats.push(clone(existing));
        await api.updateCustomFormat(applyCustomFormatChanges(existing, o.changes));
      } else if (o.action === 'remove') {
        if (!opts.removals) continue;
        const existing = formats.find((f) => f.id === o.arrId);
        if (existing) {
          backup.customFormats.push(clone(existing));
          await api.deleteCustomFormat(existing.id);
        }
        delete managed[o.key];
      }
      applied++;
    }

    const profiles = work.filter((x) => x.kind === 'qualityProfile');
    const sizes = work.find((x) => x.kind === 'qualitySize');
    const definitions = profiles.length || sizes ? await api.qualityDefinitions() : [];
    if (profiles.length) {
      const [current_, languages] = await Promise.all([
        api.qualityProfiles(),
        api.languages().catch(() => []),
      ]);
      const schema = profiles.some((p) => p.action === 'create') ? await api.qualityProfileSchema() : null;
      for (const o of profiles) {
        current = o.key;
        const unknown: string[] = [];
        const ctx = { formatIds, definitions, languages, unknown };
        if (o.action === 'create') {
          const { id: _id, ...base } = schema!;
          void _id;
          const created = await api.createQualityProfile(applyProfileChanges(base, o.changes, ctx));
          backup.created.qualityProfiles.push(created.id);
          managed[o.key] = created.id;
        } else {
          const existing = current_.find((p) => p.id === o.arrId);
          if (!existing) throw new Error('quality profile disappeared');
          backup.qualityProfiles.push(clone(existing));
          await api.updateQualityProfile(applyProfileChanges(existing, o.changes, ctx));
          managed[o.key] = existing.id;
        }
        for (const name of new Set(unknown))
          warnings.push({ code: 'unknownQuality', params: { quality: name, profile: o.label } });
        applied++;
      }
    }
    for (const o of plan.objects.filter((x) => x.kind === 'qualityProfile' && x.arrId !== undefined)) {
      managed[o.key] ??= o.arrId!;
    }

    if (sizes) {
      current = sizes.key;
      const changed = applyQualitySizeChanges(definitions, sizes.changes);
      if (changed.length) {
        backup.qualityDefinitions = definitions.filter((d) => changed.some((c) => c.id === d.id)).map(clone);
        await api.updateQualityDefinitions(changed);
        applied++;
      }
    }

    const naming = work.find((x) => x.kind === 'naming');
    if (naming) {
      current = naming.key;
      const existing = await api.naming();
      backup.naming = clone(existing);
      const next: ArrNaming = { ...existing };
      for (const c of naming.changes) next[c.field] = c.after;
      await api.updateNaming(next);
      applied++;
    }
    return { managed, backup, applied, error: null, warnings };
  } catch (err) {
    return { managed, backup, applied, error: { key: current, message: errorMessage(err) }, warnings };
  }
}

export interface RestoreResult {
  restored: number;
  errors: Array<{ what: string; message: string }>;
}

/**
 * Restores a backup. Profiles are restored with the scores of their custom
 * formats matched by name, so formats that were removed and created again
 * get their scores back.
 */
export async function restoreBackup(api: ProfileSyncApi, backup: SyncBackup): Promise<RestoreResult> {
  const result: RestoreResult = { restored: 0, errors: [] };
  const step = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      result.restored++;
    } catch (err) {
      result.errors.push({ what, message: errorMessage(err) });
    }
  };

  let formats = await api.customFormats();
  for (const cf of backup.customFormats) {
    const exists = formats.find((f) => f.id === cf.id);
    if (exists) await step(`cf:${cf.name}`, () => api.updateCustomFormat(cf));
    else {
      const { id: _id, ...rest } = cf;
      void _id;
      await step(`cf:${cf.name}`, () => api.createCustomFormat(rest));
    }
  }
  for (const id of backup.created.qualityProfiles) await step(`qp:${id}`, () => api.deleteQualityProfile(id));
  for (const id of backup.created.customFormats) await step(`cf:${id}`, () => api.deleteCustomFormat(id));

  if (backup.qualityProfiles.length) {
    formats = await api.customFormats();
    const current = await api.qualityProfiles();
    for (const saved of backup.qualityProfiles) {
      const live = current.find((p) => p.id === saved.id);
      if (!live) continue;
      const savedScores = new Map<string, number>();
      for (const fi of saved.formatItems) {
        const name = fi.name ?? backup.customFormats.find((c) => c.id === fi.format)?.name;
        if (name) savedScores.set(name.toLowerCase(), fi.score);
      }
      const formatItems = formats.map((f) => ({
        format: f.id,
        name: f.name,
        score: savedScores.get(f.name.toLowerCase()) ?? 0,
      }));
      await step(`qp:${saved.name}`, () => api.updateQualityProfile({ ...saved, formatItems }));
    }
  }
  if (backup.qualityDefinitions.length)
    await step('qs', () => api.updateQualityDefinitions(backup.qualityDefinitions));
  if (backup.naming) await step('naming', () => api.updateNaming(backup.naming!));
  return result;
}
