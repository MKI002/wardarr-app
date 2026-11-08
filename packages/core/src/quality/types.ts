// Library quality scores: how close every file in Sonarr or Radarr comes to
// the best file its quality profile allows. Adapters read the raw scan; the
// report folds it into numbers a page can draw.

/** What a custom format is about. Drives the "where the points go" chart. */
export const FORMAT_CATEGORIES = [
  'language',
  'audio',
  'video',
  'hdr',
  'source',
  'group',
  'subtitles',
  'fix',
  'other',
  'unwanted',
] as const;
export type FormatCategory = (typeof FORMAT_CATEGORIES)[number];

export interface QualityScanFormat {
  id: number;
  name: string;
  /** Implementations of the format's conditions (`LanguageSpecification`, ...). */
  specs: string[];
}

export interface QualityScanProfile {
  id: number;
  name: string;
  upgradeAllowed: boolean;
  /** "Upgrade until" custom format score. */
  cutoffFormatScore: number;
  minFormatScore: number;
  scores: Array<{ format: number; score: number }>;
}

/** One series or movie with its files. */
export interface QualityScanTitle {
  id: number;
  title: string;
  year: number | null;
  profileId: number;
  /** Deep link into the *arr app. */
  webUrl: string | null;
}

/** What the media file itself contains (from the *arr's media info). */
export interface QualityScanMedia {
  videoCodec: string | null;
  /** `DV HDR10`, `HDR10Plus`, `HLG`, empty for SDR. */
  dynamicRange: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
  /** ISO 639 codes as the app reports them (`eng`, `ger`). */
  audioLanguages: string[];
  subtitles: string[];
}

export interface QualityScanFile {
  id: number;
  titleId: number;
  /** Custom formats the app matched for this file. */
  formatIds: number[];
  /** Score the app reports, when it does (Sonarr v4, Radarr v5). */
  reportedScore: number | null;
  /** Quality name, for example `WEBDL-1080p`. */
  quality: string | null;
  resolution: number | null;
  sizeBytes: number;
  media: QualityScanMedia;
}

export interface QualityScan {
  formats: QualityScanFormat[];
  profiles: QualityScanProfile[];
  titles: QualityScanTitle[];
  files: QualityScanFile[];
}

/** Progress of a running scan, for example series read so far. */
export type QualityScanProgress = (done: number, total: number) => void;

// ------------------------------------------------------------------ report

/** File states, from best to worst. */
export type QualityTier = 'perfect' | 'target' | 'upgrading' | 'penalised';

export interface RecipeItem {
  name: string;
  category: FormatCategory;
  score: number;
}

export interface ProfileReport {
  id: number;
  name: string;
  /** Best score a file can reach in this profile. */
  perfect: number;
  /** The profile's "upgrade until" score, when upgrades are on. */
  target: number | null;
  files: number;
  percentSum: number;
  tiers: Record<QualityTier, number>;
  /** The formats that make up the perfect file. */
  recipe: RecipeItem[];
}

export interface CategoryReport {
  category: FormatCategory;
  /** Files that miss points in this category. */
  files: number;
  /** Points missed in this category over all files. */
  points: number;
}

export interface FormatReport {
  name: string;
  category: FormatCategory;
  /** Files whose perfect file has this format but they do not, or that carry this penalty. */
  files: number;
  /** Points lost through it over all those files. */
  points: number;
  penalty: boolean;
}

export interface TitleReport {
  id: number;
  title: string;
  year: number | null;
  profile: string;
  files: number;
  /** Average score of the title's files. */
  score: number;
  perfect: number;
  target: number | null;
  /** Average share of perfect, 0 to 1. */
  percent: number;
  missing: Array<{ name: string; category: FormatCategory; files: number }>;
  penalties: Array<{ name: string; files: number }>;
  webUrl: string | null;
}

export type CountMap = Record<string, number>;

export interface QualityReport {
  /** Files with a score to measure. */
  files: number;
  /** Files whose profile has no positive custom format scores. */
  unscored: number;
  sizeBytes: number;
  scoreSum: number;
  perfectSum: number;
  /** Points missing to perfect, summed over files (files above perfect count as 0). */
  gapSum: number;
  /** Sum of each file's share of perfect (0 to 1); divide by `files` for the mean. */
  percentSum: number;
  tiers: Record<QualityTier, number>;
  /** Files per tenth of perfect: 0-9 %, ..., 90-99 %, then exactly 100 %. */
  histogram: number[];
  categories: CategoryReport[];
  formats: FormatReport[];
  profiles: ProfileReport[];
  /** Titles furthest from perfect, worst first. */
  titles: TitleReport[];
  contents: {
    video: CountMap;
    hdr: CountMap;
    audio: CountMap;
    channels: CountMap;
    resolution: CountMap;
    source: CountMap;
    audioLanguages: CountMap;
    subtitles: CountMap;
  };
}
