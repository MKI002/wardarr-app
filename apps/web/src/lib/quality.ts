// The quality score report as the server sends it, and how reports of
// several instances fold into one for the "All" view.

export type FormatCategory =
  'language' | 'audio' | 'video' | 'hdr' | 'source' | 'group' | 'subtitles' | 'fix' | 'other' | 'unwanted';
export type Tier = 'perfect' | 'target' | 'upgrading' | 'penalised';
export type CountMap = Record<string, number>;

export interface ProfileReport {
  id: number;
  name: string;
  perfect: number;
  target: number | null;
  files: number;
  percentSum: number;
  tiers: Record<Tier, number>;
  recipe: Array<{ name: string; category: FormatCategory; score: number }>;
}

export interface TitleReport {
  id: number;
  title: string;
  year: number | null;
  profile: string;
  files: number;
  score: number;
  perfect: number;
  target: number | null;
  percent: number;
  missing: Array<{ name: string; category: FormatCategory; files: number }>;
  penalties: Array<{ name: string; files: number }>;
  webUrl: string | null;
}

export interface QualityReport {
  files: number;
  unscored: number;
  sizeBytes: number;
  scoreSum: number;
  perfectSum: number;
  gapSum: number;
  percentSum: number;
  tiers: Record<Tier, number>;
  histogram: number[];
  categories: Array<{ category: FormatCategory; files: number; points: number }>;
  formats: Array<{ name: string; category: FormatCategory; files: number; points: number; penalty: boolean }>;
  profiles: ProfileReport[];
  titles: TitleReport[];
  contents: Record<
    'video' | 'hdr' | 'audio' | 'channels' | 'resolution' | 'source' | 'audioLanguages' | 'subtitles',
    CountMap
  >;
}

export interface QualityInstance {
  instanceId: string;
  instanceName: string;
  adapter: string;
  adapterName: string;
  version: string | null;
  status: string;
  at: string | null;
  refreshing: boolean;
  progress: { done: number; total: number } | null;
  error: string | null;
  report: QualityReport | null;
}

/** Where a profile or title comes from, when several instances are shown together. */
export interface Origin {
  instanceId: string;
  instanceName: string;
  adapter: string;
  adapterName: string;
}

export type MergedReport = Omit<QualityReport, 'profiles' | 'titles'> & {
  profiles: Array<ProfileReport & Origin>;
  titles: Array<TitleReport & Origin>;
};

export const TIERS: Tier[] = ['perfect', 'target', 'upgrading', 'penalised'];

function addCounts(into: CountMap, from: CountMap): void {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}

/** Folds the reports of several instances into one. Instances without a report are skipped. */
export function mergeReports(instances: QualityInstance[]): MergedReport | null {
  const withReport = instances.filter((i) => i.report);
  if (withReport.length === 0) return null;
  const out: MergedReport = {
    files: 0,
    unscored: 0,
    sizeBytes: 0,
    scoreSum: 0,
    perfectSum: 0,
    gapSum: 0,
    percentSum: 0,
    tiers: { perfect: 0, target: 0, upgrading: 0, penalised: 0 },
    histogram: new Array<number>(11).fill(0),
    categories: [],
    formats: [],
    profiles: [],
    titles: [],
    contents: {
      video: {},
      hdr: {},
      audio: {},
      channels: {},
      resolution: {},
      source: {},
      audioLanguages: {},
      subtitles: {},
    },
  };
  const categories = new Map<FormatCategory, MergedReport['categories'][number]>();
  const formats = new Map<string, MergedReport['formats'][number]>();
  for (const inst of withReport) {
    const r = inst.report!;
    const origin: Origin = {
      instanceId: inst.instanceId,
      instanceName: inst.instanceName,
      adapter: inst.adapter,
      adapterName: inst.adapterName,
    };
    out.files += r.files;
    out.unscored += r.unscored;
    out.sizeBytes += r.sizeBytes;
    out.scoreSum += r.scoreSum;
    out.perfectSum += r.perfectSum;
    out.gapSum += r.gapSum;
    out.percentSum += r.percentSum;
    for (const t of TIERS) out.tiers[t] += r.tiers[t] ?? 0;
    r.histogram.forEach((n, i) => (out.histogram[i] = (out.histogram[i] ?? 0) + n));
    for (const c of r.categories) {
      const acc = categories.get(c.category) ?? { category: c.category, files: 0, points: 0 };
      acc.files += c.files;
      acc.points += c.points;
      categories.set(c.category, acc);
    }
    for (const f of r.formats) {
      const key = `${f.penalty}:${f.category}:${f.name}`;
      const acc = formats.get(key) ?? { ...f, files: 0, points: 0 };
      acc.files += f.files;
      acc.points += f.points;
      formats.set(key, acc);
    }
    out.profiles.push(...r.profiles.map((p) => ({ ...p, ...origin })));
    out.titles.push(...r.titles.map((t) => ({ ...t, ...origin })));
    for (const key of Object.keys(out.contents) as Array<keyof QualityReport['contents']>)
      addCounts(out.contents[key], r.contents[key] ?? {});
  }
  out.categories = [...categories.values()].sort((a, b) => b.points - a.points);
  out.formats = [...formats.values()].sort((a, b) => b.points - a.points);
  out.titles.sort((a, b) => a.percent - b.percent || b.files - a.files || a.title.localeCompare(b.title));
  return out;
}

/** The largest parts of a count map, the rest folded into one `other` entry. */
export function topParts(map: CountMap, max = 6): Array<{ key: string; value: number }> {
  const sorted = Object.entries(map)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1).reduce((s, p) => s + p.value, 0);
  return [...head, { key: 'other', value: rest }];
}

/** One file of the file list, worst first. */
export interface QualityFile extends Origin {
  fileId: number;
  titleId: number;
  title: string;
  year: number | null;
  /** File name without folders. */
  name: string | null;
  season: number | null;
  quality: string | null;
  sizeBytes: number;
  profile: string;
  score: number;
  perfect: number;
  target: number | null;
  percent: number;
  tier: Tier;
  missing: Array<{ name: string; category: FormatCategory }>;
  penalties: string[];
  webUrl: string | null;
}

export interface QualityFilePage {
  total: number;
  files: QualityFile[];
}

/** What a search of the worst files started, per instance. */
export interface QualitySearchResult {
  files: number;
  instances: Array<{
    instanceId: string;
    instanceName: string;
    files: number;
    items: number;
    error: string | null;
  }>;
}

/** Files a search can improve: below the upgrade target. */
export const SEARCHABLE: Tier[] = ['upgrading', 'penalised'];
/** Most files one search sends (the server's limit). */
export const MAX_SEARCH = 500;
