// Types of the TRaSH Guides sync. The TRaSH Guides publish their custom
// formats, quality profiles, quality sizes and naming schemes as JSON
// (https://github.com/TRaSH-Guides/Guides, MIT license). Wardarr reads that
// data, resolves a template against it and compares the result with what a
// Sonarr or Radarr instance has.

export type TrashProduct = 'radarr' | 'sonarr';
export const TRASH_PRODUCTS: readonly TrashProduct[] = ['radarr', 'sonarr'];

/** One condition of a custom format, in the shape the *arr API uses. */
export interface TrashSpecification {
  name: string;
  implementation: string;
  negate: boolean;
  required: boolean;
  /** Field values by field name, for example `{ value: '\\bHEVC\\b' }`. */
  fields: Record<string, unknown>;
}

export interface TrashCustomFormat {
  trashId: string;
  name: string;
  /** Scores by score set, for example `default`, `german` or `sqp-1-1080p`. */
  scores: Record<string, number>;
  includeCustomFormatWhenRenaming: boolean;
  specifications: TrashSpecification[];
  description?: string;
}

/** A quality or a group of qualities, top (best) first as in the guide. */
export interface TrashQualityItem {
  name: string;
  allowed: boolean;
  /** Member qualities when the item is a group. */
  items?: string[];
}

export interface TrashQualityProfile {
  trashId: string;
  name: string;
  description: string;
  url?: string;
  /** Sort group of the guide, for example 1 for the standard profiles. */
  group: number;
  /** Profile group name from quality-profile-groups, for example `German`. */
  category: string;
  scoreSet: string;
  upgradeAllowed: boolean;
  /** Name of the cutoff quality or group. */
  cutoff: string;
  minFormatScore: number;
  cutoffFormatScore: number;
  minUpgradeFormatScore?: number;
  /** Profile language (Radarr only), for example `Original` or `Any`. */
  language?: string;
  items: TrashQualityItem[];
  /** Custom formats the profile itself needs, by trash id. */
  formats: string[];
  /** Quality size preset the guide pairs with this profile. */
  qualitySize?: string;
  /** Profiles the guide keeps out of its public lists. */
  hidden: boolean;
}

export interface TrashCfGroupFormat {
  trashId: string;
  name: string;
  required: boolean;
  /** Preselected when the group is picked. */
  preselected: boolean;
}

export interface TrashCfGroup {
  trashId: string;
  name: string;
  description: string;
  /** The guide recommends the group for every matching profile. */
  recommended: boolean;
  formats: TrashCfGroupFormat[];
  /** Profiles (by trash id) the group applies to. Empty: all profiles. */
  profiles: string[];
  /** Profiles (by trash id) the group never applies to. */
  excludeProfiles: string[];
}

export interface TrashQualitySize {
  trashId: string;
  type: string;
  qualities: Array<{ quality: string; min: number; preferred: number; max: number }>;
}

/** Naming schemes by setting, each with named variants (`default`, `plex-tmdb`, ...). */
export type TrashNaming = Record<string, Record<string, string>>;

export interface TrashGuide {
  product: TrashProduct;
  customFormats: Record<string, TrashCustomFormat>;
  profiles: Record<string, TrashQualityProfile>;
  cfGroups: Record<string, TrashCfGroup>;
  qualitySizes: Record<string, TrashQualitySize>;
  naming: TrashNaming;
  /** Sets of custom formats (trash ids) that must not be combined. */
  conflicts: string[][];
  /** Files the parser skipped, with the reason. */
  skipped: Array<{ path: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Templates

export interface TemplateProfile {
  /** TRaSH quality profile. */
  trashId: string;
  /** Name in the *arr instance. Defaults to the guide name. */
  name?: string;
  /** Picked custom format groups. */
  groups: string[];
  /** Optional formats of picked groups that are switched off. */
  excludedFormats: string[];
  /** Extra custom formats, by trash id. */
  extraFormats: string[];
  /** Own scores by trash id. They survive guide updates. */
  scoreOverrides: Record<string, number>;
  /** Score set to use instead of the profile's own. */
  scoreSet?: string;
}

export interface TemplateConfig {
  profiles: TemplateProfile[];
  /** Quality size preset, or null to leave sizes alone. */
  qualitySize: string | null;
  /** Naming variant per setting, for example `{ file: 'jellyfin-tmdb' }`. Empty: leave naming alone. */
  naming: Record<string, string>;
  /** Turn on renaming when naming is managed. */
  rename: boolean;
}

export interface TrashTemplate {
  id: string;
  name: string;
  product: TrashProduct;
  config: TemplateConfig;
}

// ---------------------------------------------------------------------------
// Desired and actual state, as flat field maps

export type SyncObjectKind = 'customFormat' | 'qualityProfile' | 'qualitySize' | 'naming';

/**
 * One object Wardarr manages, described by flat fields so that guide and
 * instance can be compared field by field. Field values are JSON values.
 */
export interface SyncObject {
  kind: SyncObjectKind;
  /** Stable key: `cf:<trashId>`, `qp:<trashId>`, `qs` or `naming`. */
  key: string;
  label: string;
  fields: Record<string, unknown>;
  /** Readable names of fields, for example `score:<id>` -> the format name. */
  fieldLabels?: Record<string, string>;
}

export interface DesiredState {
  product: TrashProduct;
  objects: SyncObject[];
  warnings: TrashWarning[];
}

export interface TrashWarning {
  code:
    'unknownFormat' | 'unknownProfile' | 'unknownGroup' | 'conflict' | 'unknownQualitySize' | 'unknownNaming';
  params: Record<string, string>;
}

/** Where a difference comes from. */
export type ChangeOrigin =
  /** The guide or the template changed since the last sync. */
  | 'guide'
  /** Someone changed the setting in the instance. */
  | 'local'
  /** Never synced before. */
  | 'initial';

export interface FieldChange {
  field: string;
  /** Readable name of the field, for example the custom format of a score. */
  label?: string;
  before: unknown;
  after: unknown;
  origin: ChangeOrigin;
}

export type ObjectAction = 'create' | 'update' | 'unchanged' | 'remove';

export interface ObjectPlan {
  kind: SyncObjectKind;
  key: string;
  label: string;
  action: ObjectAction;
  /** Id of the object in the instance, when it exists. */
  arrId?: number;
  /** Existing object adopted by its name. */
  adopted?: boolean;
  changes: FieldChange[];
}

export type BrakeReason = 'cutoff' | 'qualities' | 'manyChanges' | 'removals';

export interface SyncPlan {
  product: TrashProduct;
  objects: ObjectPlan[];
  warnings: TrashWarning[];
  counts: { create: number; update: number; unchanged: number; remove: number; fields: number };
}

// ---------------------------------------------------------------------------
// *arr API shapes (Sonarr v4, Radarr v3 and later)

export interface ArrField {
  name: string;
  value?: unknown;
  [key: string]: unknown;
}

export interface ArrSpecification {
  id?: number;
  name: string;
  implementation: string;
  negate: boolean;
  required: boolean;
  fields: ArrField[];
  [key: string]: unknown;
}

export interface ArrCustomFormatBase {
  name: string;
  includeCustomFormatWhenRenaming?: boolean;
  specifications: ArrSpecification[];
  [key: string]: unknown;
}

export interface ArrCustomFormat extends ArrCustomFormatBase {
  id: number;
}

export interface ArrQuality {
  id: number;
  name: string;
  [key: string]: unknown;
}

export interface ArrProfileItem {
  id?: number;
  name?: string;
  quality?: ArrQuality;
  items: ArrProfileItem[];
  allowed: boolean;
  [key: string]: unknown;
}

export interface ArrQualityProfileBase {
  name: string;
  upgradeAllowed: boolean;
  cutoff: number;
  items: ArrProfileItem[];
  minFormatScore: number;
  cutoffFormatScore: number;
  minUpgradeFormatScore?: number;
  formatItems: Array<{ format: number; name?: string; score: number }>;
  language?: { id: number; name: string };
  [key: string]: unknown;
}

export interface ArrQualityProfile extends ArrQualityProfileBase {
  id: number;
}

export interface ArrQualityDefinition {
  id: number;
  quality: ArrQuality;
  title?: string;
  minSize: number | null;
  maxSize: number | null;
  preferredSize?: number | null;
  [key: string]: unknown;
}

export type ArrNaming = Record<string, unknown> & { id?: number };

export interface ArrLanguage {
  id: number;
  name: string;
}

/** Everything Wardarr reads from an instance before a sync. */
export interface ArrSnapshot {
  customFormats: ArrCustomFormat[];
  qualityProfiles: ArrQualityProfile[];
  qualityDefinitions: ArrQualityDefinition[];
  naming: ArrNaming;
  languages: ArrLanguage[];
}

/** Which instance objects Wardarr created or adopted, by key. */
export type ManagedIds = Record<string, number>;

/** Result of the *arr parse endpoint, for the release test. */
export interface ArrParseResult {
  title: string;
  quality: string | null;
  customFormats: Array<{ id: number; name: string }>;
  languages: string[];
  releaseGroup: string | null;
}

/**
 * Read and write access to the profile settings of a Sonarr (v4 and later)
 * or Radarr instance. Adapters with the `trashSync` capability provide it.
 */
export interface ProfileSyncApi {
  /** Throws AdapterError `unsupported` when the product version has no custom formats. */
  ensureSupported(): Promise<void>;
  customFormats(): Promise<ArrCustomFormat[]>;
  createCustomFormat(cf: ArrCustomFormatBase): Promise<ArrCustomFormat>;
  updateCustomFormat(cf: ArrCustomFormat): Promise<ArrCustomFormat>;
  deleteCustomFormat(id: number): Promise<void>;
  qualityProfiles(): Promise<ArrQualityProfile[]>;
  qualityProfileSchema(): Promise<ArrQualityProfile>;
  createQualityProfile(p: ArrQualityProfileBase): Promise<ArrQualityProfile>;
  updateQualityProfile(p: ArrQualityProfile): Promise<ArrQualityProfile>;
  deleteQualityProfile(id: number): Promise<void>;
  qualityDefinitions(): Promise<ArrQualityDefinition[]>;
  updateQualityDefinitions(defs: ArrQualityDefinition[]): Promise<void>;
  naming(): Promise<ArrNaming>;
  updateNaming(naming: ArrNaming): Promise<void>;
  languages(): Promise<ArrLanguage[]>;
  parseRelease(title: string): Promise<ArrParseResult>;
}
