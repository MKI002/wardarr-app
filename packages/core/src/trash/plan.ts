// Compares the desired state with an instance and plans the changes. Every
// difference is classified: did the guide or template change since the last
// sync, did someone change the instance by hand, or was it never synced?
import {
  NAMING_KEY,
  QUALITY_SIZE_KEY,
  cfKey,
  normalizeQualities,
  normalizeSpecs,
  scoreField,
} from './resolve.js';
import type {
  ArrCustomFormat,
  ArrProfileItem,
  ArrQualityProfile,
  ArrSnapshot,
  BrakeReason,
  ChangeOrigin,
  DesiredState,
  FieldChange,
  ManagedIds,
  ObjectPlan,
  SyncObject,
  SyncPlan,
  TrashQualityItem,
  TrashSpecification,
} from './types.js';

/** JSON with sorted object keys, for comparisons. */
export function stableJson(v: unknown): string {
  return JSON.stringify(v ?? null, (_k, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : typeof val === 'number'
        ? Math.round(val * 100) / 100
        : val,
  );
}

export const sameValue = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
const lower = (s: string) => s.trim().toLowerCase();

/** Specifications of an *arr custom format, limited to the fields the guide sets. */
export function arrSpecs(cf: ArrCustomFormat, reference?: TrashSpecification[]): TrashSpecification[] {
  return normalizeSpecs(
    cf.specifications.map((s) => {
      const ref = reference?.find((r) => r.name === s.name && r.implementation === s.implementation);
      const fields: Record<string, unknown> = {};
      for (const f of s.fields ?? []) {
        if (ref && !(f.name in ref.fields)) continue;
        fields[f.name] = f.value;
      }
      return {
        name: s.name,
        implementation: s.implementation,
        negate: !!s.negate,
        required: !!s.required,
        fields,
      };
    }),
  );
}

/** Profile items as the guide writes them: best first, groups with their members. */
export function arrQualities(items: ArrProfileItem[]): TrashQualityItem[] {
  return normalizeQualities(
    [...items].reverse().map((i) =>
      i.quality
        ? { name: i.quality.name, allowed: i.allowed }
        : {
            name: i.name ?? '',
            allowed: i.allowed,
            items: i.items.map((m) => m.quality?.name ?? m.name ?? '').filter(Boolean),
          },
    ),
  );
}

/** Name of the quality or group a profile's cutoff points at. */
export function cutoffName(p: ArrQualityProfile): string | null {
  for (const i of p.items) {
    if (i.quality && i.quality.id === p.cutoff) return i.quality.name;
    if (!i.quality && i.id === p.cutoff) return i.name ?? null;
  }
  return null;
}

export interface Match {
  arrId: number;
  adopted: boolean;
  fields: Record<string, unknown>;
}

export interface Matching {
  matches: Map<string, Match>;
  /** Arr ids of custom formats by trash id, for scores. */
  formatIds: Map<string, number>;
  /** Managed custom formats the template no longer uses. */
  orphans: Array<{ key: string; arrId: number; label: string }>;
}

function profileFields(
  p: ArrQualityProfile,
  desired: SyncObject,
  formatIds: Map<string, number>,
  snap: ArrSnapshot,
) {
  const out: Record<string, unknown> = {};
  for (const field of Object.keys(desired.fields)) {
    if (field.startsWith('score:')) {
      const arrId = formatIds.get(field.slice('score:'.length));
      const item = arrId === undefined ? undefined : p.formatItems.find((f) => f.format === arrId);
      out[field] = item ? item.score : undefined;
    } else if (field === 'cutoff') out.cutoff = cutoffName(p);
    else if (field === 'qualities') {
      // Qualities the guide does not mention are kept off; they do not count as a difference.
      const named = new Set((desired.fields.qualities as TrashQualityItem[]).map((q) => q.name));
      out.qualities = arrQualities(p.items).filter((q) => q.allowed || named.has(q.name));
    } else if (field === 'language') {
      const id = p.language?.id;
      out.language = p.language?.name ?? snap.languages.find((l) => l.id === id)?.name ?? null;
    } else out[field] = p[field];
  }
  return out;
}

/** Finds the instance objects that belong to the desired objects. */
export function matchSnapshot(desired: DesiredState, snap: ArrSnapshot, managed: ManagedIds): Matching {
  const matches = new Map<string, Match>();
  const formatIds = new Map<string, number>();
  const cfById = new Map(snap.customFormats.map((c) => [c.id, c]));
  const cfByName = new Map(snap.customFormats.map((c) => [lower(c.name), c]));
  const taken = new Set<number>();

  for (const obj of desired.objects.filter((o) => o.kind === 'customFormat')) {
    const trashId = obj.key.slice(3);
    let cf = managed[obj.key] !== undefined ? cfById.get(managed[obj.key]!) : undefined;
    let adopted = false;
    if (!cf) {
      cf = cfByName.get(lower(String(obj.fields.name)));
      adopted = !!cf;
    }
    if (!cf || taken.has(cf.id)) continue;
    taken.add(cf.id);
    formatIds.set(trashId, cf.id);
    matches.set(obj.key, {
      arrId: cf.id,
      adopted,
      fields: {
        name: cf.name,
        includeCustomFormatWhenRenaming: !!cf.includeCustomFormatWhenRenaming,
        specifications: arrSpecs(cf, obj.fields.specifications as TrashSpecification[]),
      },
    });
  }

  const profById = new Map(snap.qualityProfiles.map((p) => [p.id, p]));
  const profByName = new Map(snap.qualityProfiles.map((p) => [lower(p.name), p]));
  for (const obj of desired.objects.filter((o) => o.kind === 'qualityProfile')) {
    let p = managed[obj.key] !== undefined ? profById.get(managed[obj.key]!) : undefined;
    let adopted = false;
    if (!p) {
      p = profByName.get(lower(String(obj.fields.name)));
      adopted = !!p;
    }
    if (!p || taken.has(-p.id)) continue;
    taken.add(-p.id);
    matches.set(obj.key, { arrId: p.id, adopted, fields: profileFields(p, obj, formatIds, snap) });
  }

  const qs = desired.objects.find((o) => o.kind === 'qualitySize');
  if (qs) {
    const fields: Record<string, unknown> = {};
    for (const name of Object.keys(qs.fields)) {
      const d = snap.qualityDefinitions.find((q) => q.quality.name === name);
      fields[name] = d
        ? { min: d.minSize ?? 0, preferred: d.preferredSize ?? null, max: d.maxSize ?? null }
        : undefined;
    }
    matches.set(QUALITY_SIZE_KEY, { arrId: 0, adopted: false, fields });
  }
  const naming = desired.objects.find((o) => o.kind === 'naming');
  if (naming) {
    const fields: Record<string, unknown> = {};
    for (const name of Object.keys(naming.fields)) fields[name] = snap.naming[name];
    matches.set(NAMING_KEY, { arrId: Number(snap.naming.id ?? 1), adopted: false, fields });
  }

  const wanted = new Set(desired.objects.map((o) => o.key));
  const orphans: Matching['orphans'] = [];
  for (const [key, arrId] of Object.entries(managed)) {
    if (!key.startsWith('cf:') || wanted.has(key)) continue;
    const cf = cfById.get(arrId);
    if (cf) orphans.push({ key, arrId, label: cf.name });
  }
  return { matches, formatIds, orphans };
}

/** Last synced state per object key and field. */
export type AppliedState = Record<string, Record<string, unknown>>;

function originOf(key: string, field: string, actual: unknown, applied: AppliedState | null): ChangeOrigin {
  if (!applied) return 'initial';
  const obj = applied[key];
  if (!obj || !(field in obj)) return 'guide';
  return sameValue(obj[field], actual) ? 'guide' : 'local';
}

export function buildPlan(
  desired: DesiredState,
  snap: ArrSnapshot,
  managed: ManagedIds,
  applied: AppliedState | null,
): SyncPlan {
  const { matches, orphans } = matchSnapshot(desired, snap, managed);
  const objects: ObjectPlan[] = [];
  for (const obj of desired.objects) {
    const match = matches.get(obj.key);
    const exists =
      !!match && (obj.kind !== 'qualitySize' || Object.values(match.fields).some((v) => v !== undefined));
    const changes: FieldChange[] = [];
    for (const [field, after] of Object.entries(obj.fields)) {
      const before = match?.fields[field];
      if (exists && sameValue(before, after)) continue;
      // A quality the instance does not know cannot be sized.
      if (obj.kind === 'qualitySize' && before === undefined) continue;
      changes.push({
        field,
        label: obj.fieldLabels?.[field],
        before: exists ? before : undefined,
        after,
        origin: exists ? originOf(obj.key, field, before, applied) : applied ? 'guide' : 'initial',
      });
    }
    const isSingleton = obj.kind === 'qualitySize' || obj.kind === 'naming';
    objects.push({
      kind: obj.kind,
      key: obj.key,
      label: obj.label,
      action: exists || isSingleton ? (changes.length ? 'update' : 'unchanged') : 'create',
      arrId: match?.arrId,
      adopted: match?.adopted || undefined,
      changes,
    });
  }
  for (const o of orphans) {
    objects.push({
      kind: 'customFormat',
      key: o.key,
      label: o.label,
      action: 'remove',
      arrId: o.arrId,
      changes: [],
    });
  }
  return summarize({ product: desired.product, objects, warnings: desired.warnings });
}

function summarize(plan: Omit<SyncPlan, 'counts'>): SyncPlan {
  const counts = { create: 0, update: 0, unchanged: 0, remove: 0, fields: 0 };
  for (const o of plan.objects) {
    counts[o.action]++;
    counts.fields += o.changes.length;
  }
  return { ...plan, counts };
}

/** Keeps only changes of the given origins. Removals are dropped unless asked for. */
export function filterPlan(plan: SyncPlan, origins: ChangeOrigin[], removals = false): SyncPlan {
  const objects = plan.objects.map((o) => {
    if (o.action === 'remove') return removals ? o : { ...o, action: 'unchanged' as const };
    const changes = o.changes.filter((c) => origins.includes(c.origin));
    if (o.action === 'create')
      return changes.length === o.changes.length ? o : { ...o, action: 'unchanged' as const, changes: [] };
    return { ...o, changes, action: changes.length ? o.action : ('unchanged' as const) };
  });
  return summarize({ ...plan, objects });
}

/** Changes the guard must not apply on its own. */
export function brakesFor(plan: SyncPlan, maxChanges: number): BrakeReason[] {
  const out = new Set<BrakeReason>();
  for (const o of plan.objects) {
    if (o.action === 'remove') out.add('removals');
    if (o.kind !== 'qualityProfile' || o.action !== 'update') continue;
    for (const c of o.changes) {
      if (c.field === 'cutoff') out.add('cutoff');
      if (c.field === 'qualities') out.add('qualities');
    }
  }
  if (plan.counts.create + plan.counts.update + plan.counts.remove > maxChanges) out.add('manyChanges');
  return [...out];
}

/** The fields a plan sets, by object key, for the next drift check. */
export function appliedFrom(desired: DesiredState): AppliedState {
  return Object.fromEntries(desired.objects.map((o) => [o.key, o.fields]));
}

/**
 * The applied state after a sync. `full` is the whole plan, `done` the part
 * that was applied. Differences that were left out (local changes in auto
 * mode) keep their previous value, so they keep counting as local drift.
 */
export function mergeApplied(
  previous: AppliedState | null,
  desired: DesiredState,
  full: SyncPlan,
  done: SyncPlan,
): AppliedState {
  const fullBy = new Map(full.objects.map((o) => [o.key, o]));
  const doneBy = new Map(done.objects.map((o) => [o.key, o]));
  const out: AppliedState = {};
  for (const obj of desired.objects) {
    const f = fullBy.get(obj.key);
    const d = doneBy.get(obj.key);
    const prev = previous?.[obj.key];
    if (f?.action === 'create' && d?.action !== 'create') {
      if (prev) out[obj.key] = prev;
      continue;
    }
    const fields: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(obj.fields)) {
      const differed = f?.changes.some((c) => c.field === field) ?? false;
      const appliedNow = d?.action !== 'unchanged' && (d?.changes.some((c) => c.field === field) ?? false);
      if (!differed || appliedNow) fields[field] = value;
      else if (prev && field in prev) fields[field] = prev[field];
    }
    out[obj.key] = fields;
  }
  return out;
}

export { cfKey, scoreField };
