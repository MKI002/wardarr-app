// Reads every file of Sonarr (v4 and later) or Radarr with the custom formats
// the app matched for it, the quality profiles' scores and the file's media
// info. Wardarr only reads here; nothing is changed in the app.
//
// Sonarr lists episode files per series only, so a big library takes one
// call per series (a few at a time). Radarr lists movie files by id, in
// batches.
import {
  AdapterError,
  type QualityScan,
  type QualityScanFile,
  type QualityScanProgress,
  type QualityScanTitle,
} from '@wardarr/core';
import type { ArrFamily } from './families.js';

type Rec = Record<string, unknown>;
type Get = <T>(path: string, query?: Record<string, string | number | boolean>) => Promise<T>;

const obj = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(obj) : []);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Series read at the same time in Sonarr. */
const PARALLEL = 3;
/** Movie files per request in Radarr; keeps the URL short. */
const BATCH = 100;

async function pool<T>(items: T[], parallel: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, items.length) }, worker));
}

function resolutionOf(quality: Rec, media: Rec): number | null {
  const fromQuality = num(quality.resolution);
  if (fromQuality) return fromQuality;
  // Media info reports "1920x1080".
  const m = /x(\d{3,4})$/.exec(str(media.resolution) ?? '');
  return m ? Number(m[1]) : null;
}

const split = (v: unknown): string[] =>
  (str(v) ?? '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

export function qualityFile(r: Rec, titleId: number): QualityScanFile {
  const quality = obj(obj(r.quality).quality);
  const media = obj(r.mediaInfo);
  return {
    id: num(r.id) ?? 0,
    titleId,
    formatIds: list(r.customFormats)
      .map((f) => num(f.id))
      .filter((id): id is number => id !== null),
    reportedScore: num(r.customFormatScore),
    quality: str(quality.name),
    resolution: resolutionOf(quality, media),
    sizeBytes: num(r.size) ?? 0,
    media: {
      videoCodec: str(media.videoCodec),
      dynamicRange: str(media.videoDynamicRangeType) ?? str(media.videoDynamicRange),
      audioCodec: str(media.audioCodec),
      audioChannels: num(media.audioChannels),
      audioLanguages: split(media.audioLanguages),
      subtitles: split(media.subtitles),
    },
  };
}

function title(r: Rec, baseUrl: string, kind: 'series' | 'movie'): QualityScanTitle {
  const slug = str(r.titleSlug) ?? (kind === 'movie' ? String(num(r.tmdbId) ?? '') : '');
  return {
    id: num(r.id) ?? 0,
    title: str(r.title) ?? `#${String(r.id)}`,
    year: num(r.year) || null,
    profileId: num(r.qualityProfileId) ?? 0,
    webUrl: slug ? `${baseUrl}/${kind === 'movie' ? 'movie' : 'series'}/${encodeURIComponent(slug)}` : null,
  };
}

export async function readQualityScan(
  get: Get,
  family: ArrFamily,
  baseUrl: string,
  onProgress?: QualityScanProgress,
): Promise<QualityScan> {
  if (family !== 'series' && family !== 'movie')
    throw new AdapterError('unsupported', 'quality scores need Sonarr or Radarr');
  const [formats, profiles] = await Promise.all([
    get<unknown>('/customformat'),
    get<unknown>('/qualityprofile'),
  ]);
  const scan: QualityScan = {
    formats: list(formats).map((f) => ({
      id: num(f.id) ?? 0,
      name: str(f.name) ?? `#${String(f.id)}`,
      specs: list(f.specifications)
        .map((s) => str(s.implementation))
        .filter((s): s is string => !!s),
    })),
    profiles: list(profiles).map((p) => ({
      id: num(p.id) ?? 0,
      name: str(p.name) ?? `#${String(p.id)}`,
      upgradeAllowed: p.upgradeAllowed !== false,
      cutoffFormatScore: num(p.cutoffFormatScore) ?? 0,
      minFormatScore: num(p.minFormatScore) ?? 0,
      scores: list(p.formatItems)
        .map((i) => ({ format: num(i.format) ?? -1, score: num(i.score) ?? 0 }))
        .filter((i) => i.format >= 0),
    })),
    titles: [],
    files: [],
  };

  if (family === 'series') {
    const series = list(await get<unknown>('/series')).filter((s) => {
      const count = num(obj(s.statistics).episodeFileCount);
      return count === null || count > 0;
    });
    scan.titles = series.map((s) => title(s, baseUrl, 'series'));
    let done = 0;
    onProgress?.(0, series.length);
    await pool(scan.titles, PARALLEL, async (t) => {
      const files = list(await get<unknown>('/episodefile', { seriesId: t.id }));
      for (const f of files) scan.files.push(qualityFile(f, t.id));
      onProgress?.(++done, series.length);
    });
    return scan;
  }

  const movies = list(await get<unknown>('/movie')).filter((m) => m.hasFile !== false);
  const fileToMovie = new Map<number, number>();
  for (const m of movies) {
    const fileId = num(obj(m.movieFile).id) ?? num(m.movieFileId);
    const movieId = num(m.id);
    if (fileId && movieId !== null) fileToMovie.set(fileId, movieId);
  }
  const withFile = new Set(fileToMovie.values());
  scan.titles = movies.filter((m) => withFile.has(num(m.id) ?? -1)).map((m) => title(m, baseUrl, 'movie'));
  const ids = [...fileToMovie.keys()];
  const batches: number[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));
  let done = 0;
  onProgress?.(0, ids.length);
  await pool(batches, 2, async (batch) => {
    const query = batch.map((id) => `movieFileIds=${id}`).join('&');
    const files = list(await get<unknown>(`/moviefile?${query}`));
    for (const f of files) {
      const movieId = num(f.movieId) ?? fileToMovie.get(num(f.id) ?? -1);
      if (movieId !== null && movieId !== undefined) scan.files.push(qualityFile(f, movieId));
    }
    done += batch.length;
    onProgress?.(done, ids.length);
  });
  return scan;
}
