// The four API shapes of *arr apps. Sonarr and Whisparr v2 manage series,
// Radarr and Whisparr v3 movies, Lidarr music and Readarr books. Each family
// knows how to read its queue extras, wanted lists, import previews and
// history, and how to build its search and import commands.
import type { HistoryEvent, ImportPreviewFile, QueueItem, SearchTarget, WantedItem } from '@wardarr/core';

export type ArrFamily = 'series' | 'movie' | 'music' | 'book';

type Rec = Record<string, unknown>;
type Getter = <T>(path: string, query?: Record<string, string | number | boolean>) => Promise<T>;

interface Paged<T> {
  totalRecords: number;
  records: T[];
}

export interface FamilyImpl {
  /** Extra query flags so queue records include the library entry. */
  queueIncludes: Record<string, boolean>;
  queueExtras(
    r: Rec,
    tags: Map<number, string>,
  ): Pick<QueueItem, 'inLibrary' | 'tags' | 'searchTarget' | 'titleKey' | 'parentId' | 'seasonNumber'>;
  wanted(
    list: 'missing' | 'cutoff',
    opts: { monitoredOnly: boolean; max: number },
    get: Getter,
  ): Promise<WantedItem[]>;
  searchCommand(target: SearchTarget): Rec;
  previewFile(file: Rec): ImportPreviewFile;
  importFile(raw: Rec, downloadId: string): Rec;
  historyEvent(r: Rec): HistoryEvent;
}

const obj = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const ids = (v: unknown): number[] =>
  Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
const pad = (n: unknown) => String(num(n) ?? 0).padStart(2, '0');

function labels(tagIds: unknown, tags: Map<number, string>): string[] {
  return ids(tagIds)
    .map((id) => tags.get(id))
    .filter((l): l is string => !!l);
}

function rejections(file: Rec): string[] {
  const list = Array.isArray(file.rejections) ? file.rejections : [];
  return list.map((r) => str(obj(r).reason) ?? String(r));
}

function historyType(eventType: unknown): HistoryEvent['type'] {
  const t = String(eventType ?? '').toLowerCase();
  if (t === 'grabbed') return 'grabbed';
  if (t.includes('imported')) return 'imported';
  if (t === 'downloadfailed') return 'failed';
  return 'other';
}

async function paged(
  get: Getter,
  path: string,
  query: Record<string, string | number | boolean>,
  max: number,
): Promise<Rec[]> {
  const out: Rec[] = [];
  for (let page = 1; page <= 20 && out.length < max; page++) {
    const res = await get<Paged<Rec>>(path, { page, pageSize: Math.min(250, max), ...query });
    out.push(...res.records);
    if (out.length >= res.totalRecords || res.records.length === 0) break;
  }
  return out.slice(0, max);
}

const historyBase = (r: Rec, mediaField: string): HistoryEvent => ({
  at: str(r.date) ?? new Date(0).toISOString(),
  type: historyType(r.eventType),
  mediaId: num(r[mediaField]) ?? null,
  downloadId: str(r.downloadId) ?? null,
});

const series: FamilyImpl = {
  queueIncludes: { includeSeries: true, includeEpisode: true },
  queueExtras(r, tags) {
    const episode = obj(r.episode);
    const episodeId = num(r.episodeId) ?? num(episode.id);
    return {
      inLibrary: typeof episode.hasFile === 'boolean' ? episode.hasFile : undefined,
      tags: labels(obj(r.series).tags, tags),
      titleKey: episodeId ? `episode:${episodeId}` : undefined,
      searchTarget: episodeId ? { kind: 'episodes', ids: [episodeId] } : undefined,
      parentId: num(r.seriesId),
      seasonNumber: num(r.seasonNumber) ?? num(episode.seasonNumber),
    };
  },
  async wanted(list, opts, get) {
    const records = await paged(
      get,
      `/wanted/${list}`,
      {
        includeSeries: true,
        monitored: opts.monitoredOnly,
        sortKey: 'episodes.airDateUtc',
        sortDirection: 'descending',
      },
      opts.max,
    );
    return records.map((e): WantedItem => {
      const s = obj(e.series);
      return {
        key: `episode:${String(e.id)}`,
        title: `${str(s.title) ?? 'Series'} S${pad(e.seasonNumber)}E${pad(e.episodeNumber)}`,
        mediaKind: 'episode',
        mediaId: num(e.id) ?? 0,
        parentId: num(e.seriesId),
        parentTitle: str(s.title),
        seasonNumber: num(e.seasonNumber),
        monitored: e.monitored !== false && s.monitored !== false,
        tags: ids(s.tags),
        qualityProfileId: num(s.qualityProfileId),
        year: num(s.year),
        releaseDate: str(e.airDateUtc),
      };
    });
  },
  searchCommand(target) {
    if (target.kind === 'season')
      return { name: 'SeasonSearch', seriesId: target.seriesId, seasonNumber: target.seasonNumber };
    return { name: 'EpisodeSearch', episodeIds: 'ids' in target ? target.ids : [] };
  },
  previewFile(file) {
    const s = obj(file.series);
    const episodes = Array.isArray(file.episodes) ? file.episodes.map(obj) : [];
    const target =
      s.title && episodes.length > 0
        ? `${String(s.title)} ${episodes.map((e) => `S${pad(file.seasonNumber ?? e.seasonNumber)}E${pad(e.episodeNumber)}`).join(' ')}`
        : null;
    return {
      path: str(file.path) ?? '',
      name: str(file.name) ?? '',
      target,
      rejections: rejections(file),
      raw: file,
    };
  },
  importFile(raw, downloadId) {
    return {
      path: raw.path,
      folderName: raw.folderName,
      seriesId: obj(raw.series).id,
      episodeIds: (Array.isArray(raw.episodes) ? raw.episodes : []).map((e) => obj(e).id),
      quality: raw.quality,
      languages: raw.languages,
      releaseGroup: raw.releaseGroup,
      indexerFlags: raw.indexerFlags,
      releaseType: raw.releaseType,
      downloadId,
    };
  },
  historyEvent: (r) => historyBase(r, 'episodeId'),
};

const movie: FamilyImpl = {
  queueIncludes: { includeMovie: true },
  queueExtras(r, tags) {
    const m = obj(r.movie);
    const movieId = num(r.movieId);
    return {
      inLibrary: typeof m.hasFile === 'boolean' ? m.hasFile : undefined,
      tags: labels(m.tags, tags),
      titleKey: movieId ? `movie:${movieId}` : undefined,
      searchTarget: movieId ? { kind: 'movies', ids: [movieId] } : undefined,
    };
  },
  async wanted(list, opts, get) {
    const toItem = (m: Rec): WantedItem => ({
      key: `movie:${String(m.id)}`,
      title: m.year ? `${str(m.title) ?? 'Movie'} (${String(m.year)})` : (str(m.title) ?? 'Movie'),
      mediaKind: 'movie',
      mediaId: num(m.id) ?? 0,
      monitored: m.monitored !== false,
      tags: ids(m.tags),
      qualityProfileId: num(m.qualityProfileId),
      year: num(m.year),
      releaseDate: str(m.digitalRelease) ?? str(m.physicalRelease) ?? str(m.inCinemas),
    });
    if (list === 'cutoff') {
      const records = await paged(get, '/wanted/cutoff', { monitored: opts.monitoredOnly }, opts.max);
      return records.map(toItem);
    }
    // The movie list includes availability, which the missing list lacks.
    const movies = await get<Rec[]>('/movie');
    return movies
      .filter((m) => m.hasFile === false && m.isAvailable !== false)
      .filter((m) => !opts.monitoredOnly || m.monitored !== false)
      .slice(0, opts.max)
      .map(toItem);
  },
  searchCommand(target) {
    return { name: 'MoviesSearch', movieIds: 'ids' in target ? target.ids : [] };
  },
  previewFile(file) {
    const m = obj(file.movie);
    const target = m.title ? `${String(m.title)}${m.year ? ` (${String(m.year)})` : ''}` : null;
    return {
      path: str(file.path) ?? '',
      name: str(file.name) ?? '',
      target,
      rejections: rejections(file),
      raw: file,
    };
  },
  importFile(raw, downloadId) {
    return {
      path: raw.path,
      folderName: raw.folderName,
      movieId: obj(raw.movie).id,
      quality: raw.quality,
      languages: raw.languages,
      releaseGroup: raw.releaseGroup,
      indexerFlags: raw.indexerFlags,
      downloadId,
    };
  },
  historyEvent: (r) => historyBase(r, 'movieId'),
};

const music: FamilyImpl = {
  queueIncludes: { includeArtist: true, includeAlbum: true },
  queueExtras(r, tags) {
    const album = obj(r.album);
    const albumId = num(r.albumId);
    const pct = num(obj(album.statistics).percentOfTracks);
    return {
      inLibrary: pct === undefined ? undefined : pct >= 100,
      tags: labels(obj(r.artist).tags, tags),
      titleKey: albumId ? `album:${albumId}` : undefined,
      searchTarget: albumId ? { kind: 'albums', ids: [albumId] } : undefined,
      parentId: num(r.artistId),
    };
  },
  async wanted(list, opts, get) {
    const records = await paged(
      get,
      `/wanted/${list}`,
      { includeArtist: true, monitored: opts.monitoredOnly },
      opts.max,
    );
    return records.map((a): WantedItem => {
      const artist = obj(a.artist);
      return {
        key: `album:${String(a.id)}`,
        title: `${str(artist.artistName) ?? 'Artist'} – ${str(a.title) ?? 'Album'}`,
        mediaKind: 'album',
        mediaId: num(a.id) ?? 0,
        parentId: num(a.artistId),
        parentTitle: str(artist.artistName),
        monitored: a.monitored !== false && artist.monitored !== false,
        tags: ids(artist.tags),
        qualityProfileId: num(artist.qualityProfileId),
        year: str(a.releaseDate) ? new Date(String(a.releaseDate)).getUTCFullYear() : undefined,
        releaseDate: str(a.releaseDate),
      };
    });
  },
  searchCommand(target) {
    return { name: 'AlbumSearch', albumIds: 'ids' in target ? target.ids : [] };
  },
  previewFile(file) {
    const artist = obj(file.artist);
    const album = obj(file.album);
    const tracks = Array.isArray(file.tracks) ? file.tracks.map(obj) : [];
    const target =
      album.title && tracks.length > 0
        ? `${str(artist.artistName) ?? ''} – ${String(album.title)} · ${tracks.map((t) => String(t.trackNumber ?? t.absoluteTrackNumber ?? '?')).join(', ')}`
        : null;
    return {
      path: str(file.path) ?? '',
      name: str(file.name) ?? '',
      target,
      rejections: rejections(file),
      raw: file,
    };
  },
  importFile(raw, downloadId) {
    return {
      path: raw.path,
      artistId: obj(raw.artist).id,
      albumId: obj(raw.album).id,
      albumReleaseId: raw.albumReleaseId,
      trackIds: (Array.isArray(raw.tracks) ? raw.tracks : []).map((t) => obj(t).id),
      quality: raw.quality,
      releaseGroup: raw.releaseGroup,
      disableReleaseSwitching: false,
      downloadId,
    };
  },
  historyEvent: (r) => historyBase(r, 'albumId'),
};

const book: FamilyImpl = {
  queueIncludes: { includeAuthor: true, includeBook: true },
  queueExtras(r, tags) {
    const b = obj(r.book);
    const bookId = num(r.bookId);
    const files = num(obj(b.statistics).bookFileCount);
    return {
      inLibrary: files === undefined ? undefined : files > 0,
      tags: labels(obj(r.author).tags, tags),
      titleKey: bookId ? `book:${bookId}` : undefined,
      searchTarget: bookId ? { kind: 'books', ids: [bookId] } : undefined,
      parentId: num(r.authorId),
    };
  },
  async wanted(list, opts, get) {
    const records = await paged(
      get,
      `/wanted/${list}`,
      { includeAuthor: true, monitored: opts.monitoredOnly },
      opts.max,
    );
    return records.map((b): WantedItem => {
      const author = obj(b.author);
      return {
        key: `book:${String(b.id)}`,
        title: `${str(author.authorName) ?? 'Author'} – ${str(b.title) ?? 'Book'}`,
        mediaKind: 'book',
        mediaId: num(b.id) ?? 0,
        parentId: num(b.authorId),
        parentTitle: str(author.authorName),
        monitored: b.monitored !== false && author.monitored !== false,
        tags: ids(author.tags),
        qualityProfileId: num(author.qualityProfileId),
        year: str(b.releaseDate) ? new Date(String(b.releaseDate)).getUTCFullYear() : undefined,
        releaseDate: str(b.releaseDate),
      };
    });
  },
  searchCommand(target) {
    return { name: 'BookSearch', bookIds: 'ids' in target ? target.ids : [] };
  },
  previewFile(file) {
    const author = obj(file.author);
    const b = obj(file.book);
    const target = b.title ? `${str(author.authorName) ?? ''} – ${String(b.title)}` : null;
    return {
      path: str(file.path) ?? '',
      name: str(file.name) ?? '',
      target,
      rejections: rejections(file),
      raw: file,
    };
  },
  importFile(raw, downloadId) {
    return {
      path: raw.path,
      authorId: obj(raw.author).id,
      bookId: obj(raw.book).id,
      foreignEditionId: raw.foreignEditionId,
      quality: raw.quality,
      releaseGroup: raw.releaseGroup,
      downloadId,
    };
  },
  historyEvent: (r) => historyBase(r, 'bookId'),
};

export const FAMILIES: Record<ArrFamily, FamilyImpl> = { series, movie, music, book };
