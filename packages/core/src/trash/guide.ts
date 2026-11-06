// Reads the TRaSH Guides JSON files into a TrashGuide per product. The parser
// is lenient: a file it does not understand is skipped and listed, so one odd
// file never blocks the rest of the guide.
import { z } from 'zod';
import type {
  TrashCfGroup,
  TrashCustomFormat,
  TrashGuide,
  TrashNaming,
  TrashProduct,
  TrashQualityProfile,
  TrashQualitySize,
} from './types.js';

/** Folders below `docs/json/<product>/` that Wardarr reads. */
export const TRASH_FOLDERS = [
  'cf',
  'cf-groups',
  'quality-profiles',
  'quality-profile-groups',
  'quality-size',
  'naming',
] as const;
export const TRASH_JSON_ROOT = 'docs/json';

const truthy = z.union([z.boolean(), z.string()]).transform((v) => v === true || v === 'true');

const specSchema = z.object({
  name: z.string(),
  implementation: z.string(),
  negate: z.boolean().default(false),
  required: z.boolean().default(false),
  fields: z.union([
    z.record(z.string(), z.unknown()),
    z.array(z.object({ name: z.string(), value: z.unknown() })),
  ]),
});

const cfSchema = z.object({
  trash_id: z.string().regex(/^[0-9a-f]{32}$/),
  name: z.string().min(1),
  trash_scores: z.record(z.string(), z.number()).optional(),
  trash_description: z.string().optional(),
  includeCustomFormatWhenRenaming: z.boolean().default(false),
  specifications: z.array(specSchema),
});

const qualityItemSchema = z.object({
  name: z.string(),
  allowed: z.boolean(),
  items: z.array(z.string()).optional(),
});

const profileSchema = z.object({
  trash_id: z.string().min(1),
  name: z.string().min(1),
  trash_description: z.string().default(''),
  trash_url: z.string().optional(),
  trash_score_set: z.string().optional(),
  trash_quality_definition: z.record(z.string(), z.string()).optional(),
  visible: z.string().optional(),
  group: z.number().default(99),
  upgradeAllowed: z.boolean(),
  cutoff: z.string(),
  minFormatScore: z.number(),
  cutoffFormatScore: z.number(),
  minUpgradeFormatScore: z.number().optional(),
  language: z.string().optional(),
  items: z.array(qualityItemSchema),
  formatItems: z.record(z.string(), z.string()).default({}),
});

const groupSchema = z.object({
  trash_id: z.string().min(1),
  name: z.string().min(1),
  trash_description: z.string().default(''),
  default: truthy.optional(),
  custom_formats: z.array(
    z.object({
      trash_id: z.string(),
      name: z.string(),
      required: z.boolean().default(false),
      default: truthy.optional(),
    }),
  ),
  quality_profiles: z
    .object({
      include: z.record(z.string(), z.string()).optional(),
      exclude: z.record(z.string(), z.string()).optional(),
    })
    .default({}),
});

const sizeSchema = z.object({
  trash_id: z.string().min(1),
  type: z.string(),
  qualities: z.array(
    z.object({ quality: z.string(), min: z.number(), preferred: z.number(), max: z.number() }),
  ),
});

const profileGroupsSchema = z.array(
  z.object({ name: z.string(), profiles: z.record(z.string(), z.string()) }),
);
const conflictsSchema = z.object({
  custom_formats: z.array(z.record(z.string(), z.unknown())).default([]),
});

/** TRaSH writes spec fields as an object; older files used the *arr list form. */
function fieldsObject(fields: z.infer<typeof specSchema>['fields']): Record<string, unknown> {
  if (!Array.isArray(fields)) return fields;
  return Object.fromEntries(fields.map((f) => [f.name, f.value]));
}

/** Flattens nested naming groups: `{ episodes: { daily: {...} } }` becomes `episodes.daily`. */
function flattenNaming(raw: unknown, prefix = '', out: TrashNaming = {}): TrashNaming {
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.startsWith('$')) continue;
    const name = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length && entries.every(([, v]) => typeof v === 'string')) {
        out[name] = Object.fromEntries(entries) as Record<string, string>;
      } else {
        flattenNaming(value, name, out);
      }
    }
  }
  return out;
}

/**
 * Builds the guide of one product from its files. `files` maps paths
 * relative to `docs/json/<product>/` (for example `cf/x265-hd.json`) to the
 * parsed JSON content; `conflicts.json` sits at the top level.
 */
export function parseGuide(product: TrashProduct, files: Record<string, unknown>): TrashGuide {
  const guide: TrashGuide = {
    product,
    customFormats: {},
    profiles: {},
    cfGroups: {},
    qualitySizes: {},
    naming: {},
    conflicts: [],
    skipped: [],
  };
  const skip = (path: string, err: unknown) =>
    guide.skipped.push({
      path,
      reason: err instanceof z.ZodError ? (err.issues[0]?.message ?? 'invalid') : String(err),
    });

  const categories = new Map<string, string>();
  for (const [path, json] of Object.entries(files)) {
    if (!path.startsWith('quality-profile-groups/')) continue;
    const parsed = profileGroupsSchema.safeParse(json);
    if (!parsed.success) {
      skip(path, parsed.error);
      continue;
    }
    for (const g of parsed.data) for (const id of Object.values(g.profiles)) categories.set(id, g.name);
  }

  for (const [path, json] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const folder = path.split('/')[0];
    try {
      if (folder === 'cf') {
        const cf = cfSchema.parse(json);
        guide.customFormats[cf.trash_id] = {
          trashId: cf.trash_id,
          name: cf.name,
          scores: cf.trash_scores ?? {},
          includeCustomFormatWhenRenaming: cf.includeCustomFormatWhenRenaming,
          specifications: cf.specifications.map((s) => ({
            name: s.name,
            implementation: s.implementation,
            negate: s.negate,
            required: s.required,
            fields: fieldsObject(s.fields),
          })),
          description: cf.trash_description,
        } satisfies TrashCustomFormat;
      } else if (folder === 'quality-profiles') {
        const p = profileSchema.parse(json);
        guide.profiles[p.trash_id] = {
          trashId: p.trash_id,
          name: p.name,
          description: p.trash_description,
          url: p.trash_url,
          group: p.group,
          category: categories.get(p.trash_id) ?? 'Other',
          scoreSet: p.trash_score_set ?? 'default',
          upgradeAllowed: p.upgradeAllowed,
          cutoff: p.cutoff,
          minFormatScore: p.minFormatScore,
          cutoffFormatScore: p.cutoffFormatScore,
          minUpgradeFormatScore: p.minUpgradeFormatScore,
          language: p.language,
          items: p.items,
          formats: [...new Set(Object.values(p.formatItems))],
          qualitySize: p.trash_quality_definition ? Object.values(p.trash_quality_definition)[0] : undefined,
          hidden: p.visible === 'private',
        } satisfies TrashQualityProfile;
      } else if (folder === 'cf-groups') {
        const g = groupSchema.parse(json);
        guide.cfGroups[g.trash_id] = {
          trashId: g.trash_id,
          name: g.name,
          description: g.trash_description,
          recommended: g.default === true,
          formats: g.custom_formats.map((f) => ({
            trashId: f.trash_id,
            name: f.name,
            required: f.required,
            preselected: f.required || f.default === true,
          })),
          profiles: Object.values(g.quality_profiles.include ?? {}),
          excludeProfiles: Object.values(g.quality_profiles.exclude ?? {}),
        } satisfies TrashCfGroup;
      } else if (folder === 'quality-size') {
        const s = sizeSchema.parse(json);
        guide.qualitySizes[s.trash_id] = {
          trashId: s.trash_id,
          type: s.type,
          qualities: s.qualities,
        } satisfies TrashQualitySize;
      } else if (folder === 'naming') {
        Object.assign(guide.naming, flattenNaming(json));
      } else if (path === 'conflicts.json') {
        const c = conflictsSchema.parse(json);
        guide.conflicts = c.custom_formats.map((set) => Object.keys(set)).filter((ids) => ids.length > 1);
      }
    } catch (err) {
      skip(path, err);
    }
  }
  return guide;
}

/** Profile groups in guide order, for pickers. */
export function profileCategories(guide: TrashGuide): string[] {
  const order = new Map<string, number>();
  for (const p of Object.values(guide.profiles)) {
    if (p.hidden) continue;
    order.set(p.category, Math.min(order.get(p.category) ?? Infinity, p.group));
  }
  return [...order.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
}

/** Custom format groups that apply to a profile. */
export function groupsForProfile(guide: TrashGuide, profileId: string): TrashCfGroup[] {
  return Object.values(guide.cfGroups)
    .filter(
      (g) =>
        (g.profiles.length === 0 || g.profiles.includes(profileId)) && !g.excludeProfiles.includes(profileId),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** What changed between two versions of a guide, for the changelog. */
export interface GuideChange {
  kind: 'customFormat' | 'qualityProfile' | 'cfGroup' | 'qualitySize' | 'naming';
  id: string;
  name: string;
  change: 'added' | 'removed' | 'changed';
  /** Changed parts, for example `specifications` or `scores.german`. */
  parts?: string[];
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : val,
  );

function diffParts(a: Record<string, unknown>, b: Record<string, unknown>, nested: string[] = []): string[] {
  const parts: string[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (nested.includes(key) && a[key] && b[key] && typeof a[key] === 'object') {
      for (const sub of diffParts(a[key] as Record<string, unknown>, b[key] as Record<string, unknown>))
        parts.push(`${key}.${sub}`);
    } else if (stable(a[key]) !== stable(b[key])) parts.push(key);
  }
  return parts;
}

export function diffGuides(before: TrashGuide, after: TrashGuide): GuideChange[] {
  const out: GuideChange[] = [];
  const compare = <T extends { name?: string; trashId?: string }>(
    kind: GuideChange['kind'],
    a: Record<string, T>,
    b: Record<string, T>,
    nested: string[] = [],
  ) => {
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[id];
      const y = b[id];
      const name = y?.name ?? x?.name ?? id;
      if (!x) out.push({ kind, id, name, change: 'added' });
      else if (!y) out.push({ kind, id, name, change: 'removed' });
      else {
        const parts = diffParts(x as Record<string, unknown>, y as Record<string, unknown>, nested);
        if (parts.length) out.push({ kind, id, name, change: 'changed', parts });
      }
    }
  };
  compare('customFormat', before.customFormats, after.customFormats, ['scores']);
  compare('qualityProfile', before.profiles, after.profiles);
  compare('cfGroup', before.cfGroups, after.cfGroups);
  compare('qualitySize', before.qualitySizes, after.qualitySizes);
  const naming = (g: TrashGuide) =>
    Object.fromEntries(Object.entries(g.naming).map(([k, v]) => [k, { name: k, ...v }]));
  compare('naming', naming(before), naming(after));
  return out;
}
