// Folds a quality scan into the numbers of the quality score page.
//
// The perfect file of a profile is the best format of each kind together:
// the best language, the best audio, the best video codec, the best HDR, the
// best source and so on. Formats of the same kind (say "DV" and "HDR10") only
// count together when a file in the library already carried them together;
// otherwise the best single one counts. Formats that only fix a broken
// release (repack, proper) are a bonus, never a requirement. Kinds are taken
// as independent of each other.
import { categorizeFormat } from './categorize.js';
import {
  audioGroup,
  channelGroup,
  hdrGroup,
  languageCodes,
  resolutionGroup,
  sourceGroup,
  videoGroup,
} from './media.js';
import type {
  CategoryReport,
  CountMap,
  FormatCategory,
  FormatReport,
  ProfileReport,
  QualityFileIndex,
  QualityFileRow,
  QualityReport,
  QualityScan,
  QualityScanProfile,
  QualityTier,
  RecipeItem,
  TitleReport,
} from './types.js';

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

const emptyTiers = (): Record<QualityTier, number> => ({ perfect: 0, target: 0, upgrading: 0, penalised: 0 });

interface Candidate {
  id: number;
  score: number;
}

/** The highest-scoring set of formats in which every pair was seen together. */
export function bestCompatible(items: Candidate[], together: (a: number, b: number) => boolean): Candidate[] {
  const sorted = [...items].sort((a, b) => b.score - a.score || a.id - b.id);
  if (sorted.length === 0) return [];
  // Small kinds: try every compatible set (with pruning). Large ones: greedy.
  if (sorted.length > 14) {
    const picked: Candidate[] = [];
    for (const c of sorted) if (picked.every((p) => together(p.id, c.id))) picked.push(c);
    return picked;
  }
  const suffix = sorted.map((_, i) => sorted.slice(i).reduce((s, c) => s + c.score, 0));
  let best: Candidate[] = [];
  let bestScore = -1;
  const walk = (i: number, picked: Candidate[], score: number) => {
    if (score > bestScore) {
      best = [...picked];
      bestScore = score;
    }
    if (i >= sorted.length || score + suffix[i]! <= bestScore) return;
    for (let j = i; j < sorted.length; j++) {
      const c = sorted[j]!;
      if (picked.every((p) => together(p.id, c.id))) {
        picked.push(c);
        walk(j + 1, picked, score + c.score);
        picked.pop();
      }
    }
  };
  walk(0, [], 0);
  return best;
}

interface ProfilePlan {
  profile: QualityScanProfile;
  scores: Map<number, number>;
  perfect: number;
  /** Points of the perfect file per kind. */
  byCategory: Map<FormatCategory, number>;
  recipe: Array<RecipeItem & { id: number }>;
  target: number | null;
}

interface TitleAcc {
  files: number;
  scoreSum: number;
  percentSum: number;
  missing: Map<string, { name: string; category: FormatCategory; files: number }>;
  penalties: Map<string, { name: string; files: number }>;
}

function bump(map: CountMap, key: string, by = 1): void {
  map[key] = (map[key] ?? 0) + by;
}

/** Worst first: lowest share of perfect, then lowest score. */
export function compareFileRows(a: QualityFileRow, b: QualityFileRow): number {
  return a.percent - b.percent || a.score - b.score || a.titleId - b.titleId || a.id - b.id;
}

export function buildQualityReport(scan: QualityScan, opts: { maxTitles?: number } = {}): QualityReport {
  return analyzeQuality(scan, opts).report;
}

/** The report, and every scored file worst first for lists and searches. */
export function analyzeQuality(
  scan: QualityScan,
  opts: { maxTitles?: number } = {},
): { report: QualityReport; index: QualityFileIndex } {
  const maxTitles = opts.maxTitles ?? 60;

  // Kinds of formats, judged by their best score in any profile.
  const bestScore = new Map<number, number>();
  for (const p of scan.profiles)
    for (const s of p.scores)
      bestScore.set(s.format, Math.max(bestScore.get(s.format) ?? -Infinity, s.score));
  const formats = new Map(
    scan.formats.map((f) => [
      f.id,
      { name: f.name, category: categorizeFormat(f.name, f.specs, bestScore.get(f.id) ?? 0) },
    ]),
  );
  const nameOf = (id: number) => formats.get(id)?.name ?? `#${id}`;
  const categoryOf = (id: number): FormatCategory => formats.get(id)?.category ?? 'other';

  // Which formats were seen together on one file.
  const pairs = new Set<string>();
  for (const file of scan.files) {
    const ids = [...new Set(file.formatIds)];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) pairs.add(pairKey(ids[i]!, ids[j]!));
  }
  const together = (a: number, b: number) => pairs.has(pairKey(a, b));

  const plans = new Map<number, ProfilePlan>();
  for (const profile of scan.profiles) {
    const scores = new Map(profile.scores.map((s) => [s.format, s.score]));
    const byKind = new Map<FormatCategory, Candidate[]>();
    for (const [id, score] of scores) {
      const category = categoryOf(id);
      if (score <= 0 || category === 'fix') continue;
      byKind.set(category, [...(byKind.get(category) ?? []), { id, score }]);
    }
    const recipe: ProfilePlan['recipe'] = [];
    const byCategory = new Map<FormatCategory, number>();
    for (const [category, items] of byKind) {
      const picked = bestCompatible(items, together);
      byCategory.set(
        category,
        picked.reduce((s, c) => s + c.score, 0),
      );
      for (const c of picked) recipe.push({ id: c.id, name: nameOf(c.id), category, score: c.score });
    }
    recipe.sort((a, b) => b.score - a.score);
    plans.set(profile.id, {
      profile,
      scores,
      perfect: recipe.reduce((s, r) => s + r.score, 0),
      byCategory,
      recipe,
      target: profile.upgradeAllowed ? profile.cutoffFormatScore : null,
    });
  }

  const titles = new Map(scan.titles.map((t) => [t.id, t]));
  const profileAcc = new Map<
    number,
    { files: number; percentSum: number; tiers: Record<QualityTier, number> }
  >();
  const categoryAcc = new Map<FormatCategory, CategoryReport>();
  const formatAcc = new Map<string, FormatReport>();
  const titleAcc = new Map<number, TitleAcc>();
  const rows: QualityFileRow[] = [];
  const histogram = new Array<number>(11).fill(0);
  const tiers = emptyTiers();
  const contents: QualityReport['contents'] = {
    video: {},
    hdr: {},
    audio: {},
    channels: {},
    resolution: {},
    source: {},
    audioLanguages: {},
    subtitles: {},
  };
  let files = 0;
  let unscored = 0;
  let sizeBytes = 0;
  let scoreSum = 0;
  let perfectSum = 0;
  let gapSum = 0;
  let percentSum = 0;

  for (const file of scan.files) {
    sizeBytes += file.sizeBytes;
    const m = file.media;
    bump(contents.video, videoGroup(m.videoCodec));
    bump(contents.hdr, hdrGroup(m.dynamicRange));
    bump(contents.audio, audioGroup(m.audioCodec));
    bump(contents.channels, channelGroup(m.audioChannels));
    bump(contents.resolution, resolutionGroup(file.resolution));
    bump(contents.source, sourceGroup(file.quality));
    const audioLangs = languageCodes(m.audioLanguages);
    for (const l of audioLangs.length ? audioLangs : ['und']) bump(contents.audioLanguages, l);
    const subs = languageCodes(m.subtitles);
    for (const l of subs.length ? subs : ['none']) bump(contents.subtitles, l);

    const title = titles.get(file.titleId);
    const plan = title ? plans.get(title.profileId) : undefined;
    if (!title || !plan || plan.perfect <= 0) {
      unscored++;
      continue;
    }

    const ids = [...new Set(file.formatIds)].filter((id) => plan.scores.has(id));
    const score = ids.reduce((s, id) => s + (plan.scores.get(id) ?? 0), 0);
    const percent = Math.max(0, Math.min(1, score / plan.perfect));
    const penalties = ids.filter((id) => (plan.scores.get(id) ?? 0) < 0);
    const tier: QualityTier =
      penalties.length > 0 || score < 0
        ? 'penalised'
        : score >= plan.perfect
          ? 'perfect'
          : plan.target === null || score >= plan.target
            ? 'target'
            : 'upgrading';

    files++;
    scoreSum += score;
    perfectSum += plan.perfect;
    gapSum += Math.max(0, plan.perfect - score);
    percentSum += percent;
    tiers[tier]++;
    histogram[percent >= 1 ? 10 : Math.floor(percent * 10)]!++;

    const pAcc = profileAcc.get(plan.profile.id) ?? { files: 0, percentSum: 0, tiers: emptyTiers() };
    pAcc.files++;
    pAcc.percentSum += percent;
    pAcc.tiers[tier]++;
    profileAcc.set(plan.profile.id, pAcc);

    // Points per kind: what the perfect file has there minus what this file has.
    const have = new Map<FormatCategory, number>();
    for (const id of ids) {
      const c = categoryOf(id);
      if (c === 'fix') continue;
      have.set(c, (have.get(c) ?? 0) + (plan.scores.get(id) ?? 0));
    }
    for (const c of new Set([...plan.byCategory.keys(), ...have.keys()])) {
      const lost = (plan.byCategory.get(c) ?? 0) - (have.get(c) ?? 0);
      if (lost <= 0) continue;
      const acc = categoryAcc.get(c) ?? { category: c, files: 0, points: 0 };
      acc.files++;
      acc.points += lost;
      categoryAcc.set(c, acc);
    }

    let t = titleAcc.get(title.id);
    if (!t) {
      t = { files: 0, scoreSum: 0, percentSum: 0, missing: new Map(), penalties: new Map() };
      titleAcc.set(title.id, t);
    }
    t.files++;
    t.scoreSum += score;
    t.percentSum += percent;

    const has = new Set(ids);
    const row: QualityFileRow = {
      id: file.id,
      titleId: title.id,
      name: file.name ?? null,
      season: file.season ?? null,
      quality: file.quality,
      sizeBytes: file.sizeBytes,
      score,
      percent,
      tier,
      missing: [],
      penalties,
    };
    rows.push(row);
    for (const r of plan.recipe) {
      if (has.has(r.id)) continue;
      row.missing.push(r.id);
      const key = `${r.category}:${r.name}`;
      const f = formatAcc.get(key) ?? {
        name: r.name,
        category: r.category,
        files: 0,
        points: 0,
        penalty: false,
      };
      f.files++;
      f.points += r.score;
      formatAcc.set(key, f);
      const tm = t.missing.get(key) ?? { name: r.name, category: r.category, files: 0 };
      tm.files++;
      t.missing.set(key, tm);
    }
    for (const id of penalties) {
      const name = nameOf(id);
      const key = `penalty:${name}`;
      const f = formatAcc.get(key) ?? { name, category: categoryOf(id), files: 0, points: 0, penalty: true };
      f.files++;
      f.points += -(plan.scores.get(id) ?? 0);
      formatAcc.set(key, f);
      const tp = t.penalties.get(name) ?? { name, files: 0 };
      tp.files++;
      t.penalties.set(name, tp);
    }
  }

  const profiles: ProfileReport[] = [...plans.values()]
    .filter((p) => p.perfect > 0 || profileAcc.has(p.profile.id))
    .map((p) => {
      const acc = profileAcc.get(p.profile.id);
      return {
        id: p.profile.id,
        name: p.profile.name,
        perfect: p.perfect,
        target: p.target,
        files: acc?.files ?? 0,
        percentSum: acc?.percentSum ?? 0,
        tiers: acc?.tiers ?? emptyTiers(),
        recipe: p.recipe.map(({ name, category, score }) => ({ name, category, score })),
      };
    })
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));

  const titleReports: TitleReport[] = [...titleAcc.entries()]
    .map(([id, acc]) => {
      const title = titles.get(id)!;
      const plan = plans.get(title.profileId)!;
      return {
        id,
        title: title.title,
        year: title.year,
        profile: plan.profile.name,
        files: acc.files,
        score: Math.round(acc.scoreSum / acc.files),
        perfect: plan.perfect,
        target: plan.target,
        percent: acc.percentSum / acc.files,
        missing: [...acc.missing.values()].sort((a, b) => b.files - a.files).slice(0, 6),
        penalties: [...acc.penalties.values()].sort((a, b) => b.files - a.files).slice(0, 4),
        webUrl: title.webUrl,
      };
    })
    .filter((t) => t.percent < 1)
    .sort((a, b) => a.percent - b.percent || b.files - a.files || a.title.localeCompare(b.title))
    .slice(0, maxTitles);

  const report: QualityReport = {
    files,
    unscored,
    sizeBytes,
    scoreSum,
    perfectSum,
    gapSum,
    percentSum,
    tiers,
    histogram,
    categories: [...categoryAcc.values()].sort((a, b) => b.points - a.points),
    formats: [...formatAcc.values()].sort((a, b) => b.points - a.points).slice(0, 40),
    profiles,
    titles: titleReports,
    contents,
  };

  const usedTitles = new Set(rows.map((r) => r.titleId));
  const usedFormats = new Set(rows.flatMap((r) => [...r.missing, ...r.penalties]));
  const index: QualityFileIndex = {
    titles: scan.titles.filter((t) => usedTitles.has(t.id)),
    profiles: [...plans.values()].map((p) => ({
      id: p.profile.id,
      name: p.profile.name,
      perfect: p.perfect,
      target: p.target,
    })),
    formats: [...usedFormats].map((id) => ({ id, name: nameOf(id), category: categoryOf(id) })),
    files: rows.sort(compareFileRows),
  };
  return { report, index };
}
