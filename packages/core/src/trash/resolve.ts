// Turns a template into the state an instance should have, using the guide.
import { groupsForProfile } from './guide.js';
import type {
  DesiredState,
  SyncObject,
  TemplateConfig,
  TemplateProfile,
  TrashCustomFormat,
  TrashGuide,
  TrashProduct,
  TrashQualityItem,
  TrashSpecification,
  TrashWarning,
} from './types.js';

/** *arr naming fields per guide naming setting. */
export const NAMING_FIELDS: Record<TrashProduct, Record<string, string>> = {
  radarr: { folder: 'movieFolderFormat', file: 'standardMovieFormat' },
  sonarr: {
    series: 'seriesFolderFormat',
    season: 'seasonFolderFormat',
    'episodes.standard': 'standardEpisodeFormat',
    'episodes.daily': 'dailyEpisodeFormat',
    'episodes.anime': 'animeEpisodeFormat',
  },
};
export const RENAME_FIELD: Record<TrashProduct, string> = {
  radarr: 'renameMovies',
  sonarr: 'renameEpisodes',
};

export const cfKey = (trashId: string) => `cf:${trashId}`;
export const profileKey = (trashId: string) => `qp:${trashId}`;
export const scoreField = (trashId: string) => `score:${trashId}`;
export const QUALITY_SIZE_KEY = 'qs';
export const NAMING_KEY = 'naming';

/** Specifications in a stable order with stable field order, for comparison. */
export function normalizeSpecs(specs: TrashSpecification[]): TrashSpecification[] {
  return specs
    .map((s) => ({
      name: s.name,
      implementation: s.implementation,
      negate: !!s.negate,
      required: !!s.required,
      fields: Object.fromEntries(Object.entries(s.fields).sort(([a], [b]) => a.localeCompare(b))),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.implementation.localeCompare(b.implementation));
}

export function customFormatFields(cf: TrashCustomFormat): Record<string, unknown> {
  return {
    name: cf.name,
    includeCustomFormatWhenRenaming: cf.includeCustomFormatWhenRenaming,
    specifications: normalizeSpecs(cf.specifications),
  };
}

/** Quality items as compared: top first, group members sorted. */
export function normalizeQualities(items: TrashQualityItem[]): TrashQualityItem[] {
  return items.map((i) =>
    i.items && i.items.length
      ? { name: i.name, allowed: i.allowed, items: [...i.items].sort() }
      : { name: i.name, allowed: i.allowed },
  );
}

/** The template profile the guide suggests: recommended groups, nothing else. */
export function suggestedTemplateProfile(guide: TrashGuide, profileId: string): TemplateProfile {
  return {
    trashId: profileId,
    groups: groupsForProfile(guide, profileId)
      .filter((g) => g.recommended)
      .map((g) => g.trashId),
    excludedFormats: [],
    extraFormats: [],
    scoreOverrides: {},
  };
}

/** Custom formats a template profile uses, by trash id, in a stable order. */
export function profileFormats(
  guide: TrashGuide,
  tp: TemplateProfile,
  warnings: TrashWarning[] = [],
): string[] {
  const profile = guide.profiles[tp.trashId];
  const ids = new Set<string>(profile?.formats ?? []);
  const excluded = new Set(tp.excludedFormats);
  for (const groupId of tp.groups) {
    const group = guide.cfGroups[groupId];
    if (!group) {
      warnings.push({ code: 'unknownGroup', params: { id: groupId } });
      continue;
    }
    for (const f of group.formats)
      if (f.required || (f.preselected && !excluded.has(f.trashId))) ids.add(f.trashId);
  }
  for (const id of tp.extraFormats) ids.add(id);
  return [...ids];
}

export function scoreFor(cf: TrashCustomFormat, scoreSet: string, override?: number): number {
  if (override !== undefined) return override;
  return cf.scores[scoreSet] ?? cf.scores.default ?? 0;
}

export function resolveTemplate(guide: TrashGuide, config: TemplateConfig): DesiredState {
  const warnings: TrashWarning[] = [];
  const formats = new Map<string, TrashCustomFormat>();
  const profiles: SyncObject[] = [];

  for (const tp of config.profiles) {
    const profile = guide.profiles[tp.trashId];
    if (!profile) {
      warnings.push({ code: 'unknownProfile', params: { id: tp.trashId } });
      continue;
    }
    const scoreSet = tp.scoreSet ?? profile.scoreSet;
    const fields: Record<string, unknown> = {
      name: tp.name?.trim() || profile.name,
      upgradeAllowed: profile.upgradeAllowed,
      cutoff: profile.cutoff,
      minFormatScore: profile.minFormatScore,
      cutoffFormatScore: profile.cutoffFormatScore,
      qualities: normalizeQualities(profile.items),
    };
    if (profile.minUpgradeFormatScore !== undefined)
      fields.minUpgradeFormatScore = profile.minUpgradeFormatScore;
    if (profile.language !== undefined) fields.language = profile.language;
    const fieldLabels: Record<string, string> = {};
    const used = profileFormats(guide, tp, warnings);
    for (const id of used) {
      const cf = guide.customFormats[id];
      if (!cf) {
        warnings.push({ code: 'unknownFormat', params: { id, profile: profile.name } });
        continue;
      }
      formats.set(id, cf);
      fields[scoreField(id)] = scoreFor(cf, scoreSet, tp.scoreOverrides[id]);
      fieldLabels[scoreField(id)] = cf.name;
    }
    for (const set of guide.conflicts) {
      const hit = set.filter((id) => used.includes(id));
      if (hit.length > 1) {
        warnings.push({
          code: 'conflict',
          params: {
            profile: profile.name,
            formats: hit.map((id) => guide.customFormats[id]?.name ?? id).join(', '),
          },
        });
      }
    }
    profiles.push({
      kind: 'qualityProfile',
      key: profileKey(tp.trashId),
      label: String(fields.name),
      fields,
      fieldLabels,
    });
  }

  const objects: SyncObject[] = [...formats.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((cf) => ({
      kind: 'customFormat',
      key: cfKey(cf.trashId),
      label: cf.name,
      fields: customFormatFields(cf),
    }));
  objects.push(...profiles);

  if (config.qualitySize) {
    const size = guide.qualitySizes[config.qualitySize];
    if (!size) warnings.push({ code: 'unknownQualitySize', params: { id: config.qualitySize } });
    else
      objects.push({
        kind: 'qualitySize',
        key: QUALITY_SIZE_KEY,
        label: size.type,
        fields: Object.fromEntries(
          size.qualities.map((q) => [q.quality, { min: q.min, preferred: q.preferred, max: q.max }]),
        ),
      });
  }

  const namingFields: Record<string, unknown> = {};
  for (const [setting, variant] of Object.entries(config.naming)) {
    const field = NAMING_FIELDS[guide.product][setting];
    const value = guide.naming[setting]?.[variant];
    if (!field || value === undefined) {
      warnings.push({ code: 'unknownNaming', params: { setting, variant } });
      continue;
    }
    namingFields[field] = value;
  }
  if (Object.keys(namingFields).length) {
    if (config.rename) namingFields[RENAME_FIELD[guide.product]] = true;
    objects.push({ kind: 'naming', key: NAMING_KEY, label: 'naming', fields: namingFields });
  }

  return { product: guide.product, objects, warnings };
}
