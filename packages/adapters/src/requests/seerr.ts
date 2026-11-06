// Seerr, the request manager that succeeds Overseerr and Jellyseerr.
// Music is not part of Seerr, so Discover never shows any.
import {
  AdapterError,
  defineAdapter,
  type DiscoverDetails,
  type DiscoverItem,
  type DiscoverPage,
  type ExternalUser,
  type MediaAvailability,
  type MediaRequest,
  type RequestServer,
  type RequestStatus,
  type Signal,
  type ServiceLink,
} from '@wardarr/core';
import { z } from 'zod';
import { ensureOk, jsonOf } from '../shared/http.js';
import { addressOf, link, part } from '../shared/topology.js';

interface StatusResponse {
  version?: string;
  commitTag?: string;
  updateAvailable?: boolean;
  commitsBehind?: number;
}

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

const MEDIA_STATUS: Record<number, MediaAvailability> = {
  2: 'requested',
  3: 'processing',
  4: 'partial',
  5: 'available',
};
export const mediaStatus = (v: unknown): MediaAvailability => MEDIA_STATUS[num(v) ?? 0] ?? 'unknown';

const REQUEST_STATUS: Record<number, RequestStatus> = {
  1: 'pending',
  2: 'approved',
  3: 'declined',
  4: 'failed',
  5: 'completed',
};

const yearOf = (d: unknown) => {
  const s = str(d);
  return s && /^\d{4}/.test(s) ? Number(s.slice(0, 4)) : null;
};

export function mapDiscoverItem(r: Rec): DiscoverItem | null {
  const mediaType = r.mediaType === 'movie' || r.mediaType === 'tv' ? r.mediaType : null;
  const id = num(r.id);
  if (!mediaType || id === null) return null;
  const info = obj(r.mediaInfo);
  return {
    tmdbId: id,
    mediaType,
    title: str(mediaType === 'movie' ? r.title : r.name) ?? str(r.originalTitle) ?? str(r.originalName) ?? '',
    year: yearOf(mediaType === 'movie' ? r.releaseDate : r.firstAirDate),
    overview: str(r.overview) ?? '',
    posterPath: str(r.posterPath),
    backdropPath: str(r.backdropPath),
    rating: num(r.voteAverage),
    status: mediaStatus(info.status),
    status4k: mediaStatus(info.status4k),
  };
}

function mapPage(r: Rec, mediaType?: 'movie' | 'tv'): DiscoverPage {
  const results = (Array.isArray(r.results) ? r.results : [])
    .map((x) => {
      const rec = obj(x);
      return mapDiscoverItem(mediaType && !rec.mediaType ? { ...rec, mediaType } : rec);
    })
    .filter((x): x is DiscoverItem => x !== null);
  return { page: num(r.page) ?? 1, totalPages: num(r.totalPages) ?? 1, results };
}

export const seerr = defineAdapter({
  id: 'seerr',
  name: 'Seerr',
  category: 'requests',
  lifecycle: 'active',
  homepage: 'https://seerr.dev',
  fields: [
    {
      key: 'apiKey',
      kind: 'secret',
      label: 'adapters.fields.apiKey',
      help: 'adapters.help.apiKeySeerr',
      required: true,
    },
  ],
  credentials: z.object({ apiKey: z.string().trim().min(1).max(256) }),
  capabilities: ['health', 'discover', 'requests'],
  create(ctx) {
    const base = { 'X-Api-Key': ctx.credentials.apiKey };
    /** Seerr acts as the given user when the API key comes with X-API-User. */
    const headers = (asUser?: number) => (asUser ? { ...base, 'X-API-User': String(asUser) } : base);
    const get = async <T>(path: string, query?: Record<string, string | number>, asUser?: number) =>
      jsonOf<T>(await ctx.http.request({ path: `/api/v1${path}`, query, headers: headers(asUser) }));
    const send = async <T>(method: 'POST' | 'PUT', path: string, json?: unknown, asUser?: number) => {
      const res = ensureOk(
        await ctx.http.request({ method, path: `/api/v1${path}`, headers: headers(asUser), json }),
      );
      return (res.text ? res.json<T>() : ({} as T)) as T;
    };

    // Requests carry no title; titles are looked up once and kept.
    const titles = new Map<string, { title: string | null; posterPath: string | null }>();
    const titleOf = async (mediaType: 'movie' | 'tv', tmdbId: number) => {
      const key = `${mediaType}:${tmdbId}`;
      const known = titles.get(key);
      if (known) return known;
      try {
        const r = await get<Rec>(`/${mediaType}/${tmdbId}`);
        const v = { title: str(mediaType === 'movie' ? r.title : r.name), posterPath: str(r.posterPath) };
        titles.set(key, v);
        return v;
      } catch {
        return { title: null, posterPath: null };
      }
    };

    const mapRequest = async (r: Rec): Promise<MediaRequest> => {
      const media = obj(r.media);
      const mediaType = media.mediaType === 'tv' || r.type === 'tv' ? 'tv' : 'movie';
      const tmdbId = num(media.tmdbId) ?? 0;
      const is4k = r.is4k === true;
      const t = await titleOf(mediaType, tmdbId);
      const by = obj(r.requestedBy);
      return {
        id: num(r.id) ?? 0,
        status: REQUEST_STATUS[num(r.status) ?? 0] ?? 'pending',
        mediaType,
        tmdbId,
        title: t.title,
        posterPath: t.posterPath,
        is4k,
        seasons: (Array.isArray(r.seasons) ? r.seasons : [])
          .map((s) => num(obj(s).seasonNumber))
          .filter((n): n is number => n !== null),
        createdAt: str(r.createdAt) ?? new Date(0).toISOString(),
        updatedAt: str(r.updatedAt),
        requestedBy: { id: num(by.id) ?? 0, name: str(by.displayName) ?? str(by.username) ?? '' },
        serverId: num(r.serverId),
        profileId: num(r.profileId),
        rootFolder: str(r.rootFolder),
        mediaStatus: mediaStatus(is4k ? media.status4k : media.status),
      };
    };

    const servers = async (type: 'radarr' | 'sonarr'): Promise<RequestServer[]> => {
      const list = await get<Rec[]>(`/service/${type}`);
      return Promise.all(
        list.map(async (s) => {
          const id = num(s.id) ?? 0;
          const details = await get<Rec>(`/service/${type}/${id}`).catch(() => ({}) as Rec);
          const profiles = (Array.isArray(details.profiles) ? details.profiles : []).map((p) => ({
            id: num(obj(p).id) ?? 0,
            name: str(obj(p).name) ?? '',
          }));
          const rootFolders = (Array.isArray(details.rootFolders) ? details.rootFolders : [])
            .map((f) => str(obj(f).path))
            .filter((p): p is string => !!p);
          return {
            id,
            name: str(s.name) ?? `${type} ${id}`,
            type,
            is4k: s.is4k === true,
            isDefault: s.isDefault === true,
            profiles,
            rootFolders,
            defaultProfileId: num(s.activeProfileId),
            defaultRootFolder: str(s.activeDirectory),
          };
        }),
      );
    };

    /** Radarr and Sonarr servers, and the media server, as Seerr has them configured. */
    const topology = async () => {
      const arrs = async (type: 'radarr' | 'sonarr') =>
        (await part(() => get<Rec[]>(`/settings/${type}`), [])).map((s) =>
          link(
            'requests',
            type,
            str(s.name) ?? type,
            addressOf({ host: s.hostname, port: s.port, ssl: s.useSsl, base: s.baseUrl }),
            true,
            { is4k: s.is4k === true },
          ),
        );
      const main = await part(() => get<Rec>('/settings/main'), {} as Rec);
      // 1 Plex, 2 Jellyfin, 3 Emby, 4 none. Overseerr has no field and only knows Plex.
      const type = num(main.mediaServerType);
      const media: ServiceLink[] = [];
      if (type === null || type === 1) {
        const plex = await part(() => get<Rec>('/settings/plex'), {} as Rec);
        const url = addressOf({ host: plex.ip, port: plex.port, ssl: plex.useSsl });
        if (url) media.push(link('mediaServer', 'plex', str(plex.name) ?? 'Plex', url, true));
      } else if (type === 2 || type === 3) {
        const jf = await part(() => get<Rec>('/settings/jellyfin'), {} as Rec);
        const url = addressOf({ host: jf.ip, port: jf.port, ssl: jf.useSsl, base: jf.urlBase });
        const product = type === 2 ? 'jellyfin' : 'emby';
        if (url) media.push(link('mediaServer', product, str(jf.name) ?? product, url, true));
      }
      const [radarr, sonarr] = await Promise.all([arrs('radarr'), arrs('sonarr')]);
      return { links: [...radarr, ...sonarr, ...media], folders: [] };
    };

    return {
      topology,
      async testConnection() {
        // /status is public in Seerr; /auth/me proves the API key works.
        const status = await get<StatusResponse>('/status');
        if (typeof status.version !== 'string') throw new AdapterError('badResponse', 'not a Seerr API');
        await get<{ id?: number }>('/auth/me');
        return { version: status.version };
      },
      async health() {
        const status = await get<StatusResponse>('/status');
        if (!status.updateAvailable) return [];
        return [
          {
            origin: 'service',
            instance: { id: ctx.instanceId, name: ctx.instanceName, adapter: 'seerr' },
            kind: 'update',
            source: 'Status',
            level: 'info',
            message: 'Update available',
            data: { version: '' },
          } satisfies Signal,
        ];
      },
      async discover(list, page, asUser) {
        const path =
          list === 'trending'
            ? '/discover/trending'
            : list === 'movies'
              ? '/discover/movies'
              : '/discover/tv';
        const r = await get<Rec>(path, { page }, asUser);
        return mapPage(r, list === 'movies' ? 'movie' : list === 'tv' ? 'tv' : undefined);
      },
      async searchMedia(query, page, asUser) {
        return mapPage(await get<Rec>('/search', { query, page }, asUser));
      },
      async mediaDetails(mediaType, tmdbId, asUser) {
        const r = await get<Rec>(`/${mediaType}/${tmdbId}`, undefined, asUser);
        const item = mapDiscoverItem({ ...r, mediaType });
        if (!item) throw new AdapterError('badResponse', 'unexpected media');
        const infoSeasons = new Map(
          (Array.isArray(obj(r.mediaInfo).seasons) ? (obj(r.mediaInfo).seasons as unknown[]) : []).map(
            (s) => [num(obj(s).seasonNumber), obj(s)],
          ),
        );
        const seasons = (Array.isArray(r.seasons) ? r.seasons : [])
          .map((s) => obj(s))
          .filter((s) => (num(s.seasonNumber) ?? 0) > 0)
          .map((s) => {
            const n = num(s.seasonNumber) ?? 0;
            const info = infoSeasons.get(n) ?? {};
            return {
              seasonNumber: n,
              name: str(s.name) ?? `Season ${n}`,
              episodeCount: num(s.episodeCount) ?? 0,
              status: mediaStatus(info.status),
              status4k: mediaStatus(info.status4k),
            };
          });
        return { ...item, seasons, tvdbId: num(obj(r.externalIds).tvdbId) } satisfies DiscoverDetails;
      },
      async requestServers() {
        const [radarr, sonarr] = await Promise.all([servers('radarr'), servers('sonarr')]);
        return [...radarr, ...sonarr];
      },
      async requests(filter) {
        const query: Record<string, string | number> = {
          take: filter.take,
          skip: filter.skip,
          sort: 'added',
          filter: filter.status ?? 'all',
        };
        if (filter.requestedBy) query.requestedBy = filter.requestedBy;
        const r = await get<Rec>('/request', query);
        const results = await Promise.all(
          (Array.isArray(r.results) ? r.results : []).map((x) => mapRequest(obj(x))),
        );
        return { total: num(obj(r.pageInfo).results) ?? results.length, results };
      },
      async createRequest(req, asUser) {
        const body: Rec = { mediaType: req.mediaType, mediaId: req.tmdbId, is4k: req.is4k };
        if (req.mediaType === 'tv') {
          body.seasons = req.seasons ?? 'all';
          if (req.tvdbId) body.tvdbId = req.tvdbId;
        }
        if (req.serverId !== undefined) body.serverId = req.serverId;
        if (req.profileId !== undefined) body.profileId = req.profileId;
        if (req.rootFolder !== undefined) body.rootFolder = req.rootFolder;
        return mapRequest(await send<Rec>('POST', '/request', body, asUser));
      },
      async setRequestStatus(id, status) {
        return mapRequest(await send<Rec>('POST', `/request/${id}/${status}`));
      },
      async editRequest(id, edit) {
        const current = obj(await get<Rec>(`/request/${id}`));
        const mediaType = obj(current.media).mediaType === 'tv' ? 'tv' : 'movie';
        const body: Rec = { mediaType, ...edit };
        if (mediaType === 'tv' && !edit.seasons) {
          body.seasons = (Array.isArray(current.seasons) ? current.seasons : []).map((s) =>
            num(obj(s).seasonNumber),
          );
        }
        return mapRequest(await send<Rec>('PUT', `/request/${id}`, body));
      },
      async retryRequest(id) {
        return mapRequest(await send<Rec>('POST', `/request/${id}/retry`));
      },
      async users() {
        const out: ExternalUser[] = [];
        for (let skip = 0; skip < 2000; skip += 100) {
          const r = await get<Rec>('/user', { take: 100, skip });
          const list = Array.isArray(r.results) ? r.results.map(obj) : [];
          for (const u of list) {
            const aliases = [u.username, u.plexUsername, u.jellyfinUsername, u.displayName]
              .map(str)
              .filter((a): a is string => !!a);
            out.push({
              id: num(u.id) ?? 0,
              name: str(u.displayName) ?? aliases[0] ?? `#${String(u.id)}`,
              aliases,
            });
          }
          if (list.length < 100) break;
        }
        return out;
      },
      webUrl(target) {
        return `${ctx.baseUrl}${target?.kind === 'settings' ? '/settings' : target?.kind === 'system' ? '/settings/about' : '/'}`;
      },
    };
  },
});
