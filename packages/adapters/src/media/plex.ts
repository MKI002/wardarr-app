// Plex Media Server. Uses an X-Plex-Token instead of an API key.
import { AdapterError, defineAdapter, type LibraryStats, type StreamSession } from '@wardarr/core';
import { z } from 'zod';
import { jsonOf } from '../shared/http.js';
import { folder } from '../shared/topology.js';
import { MAX_LIBRARY_PAGES, accumulate, emptyLibrary, normalizeCodec } from './library.js';

interface PlexSession {
  sessionKey?: string;
  type?: string;
  title?: string;
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  duration?: number;
  viewOffset?: number;
  User?: { title?: string };
  Player?: { title?: string; product?: string; state?: string };
  Session?: { id?: string };
  TranscodeSession?: { videoDecision?: string };
  Media?: Array<{ videoResolution?: string }>;
}

function resolution(r: string | undefined): string | undefined {
  if (!r) return undefined;
  const v = r.toLowerCase();
  if (v === '4k') return '4K';
  if (/^\d+$/.test(v)) {
    const n = Number(v);
    return n >= 2000 ? '4K' : n >= 1000 ? '1080p' : n >= 700 ? '720p' : 'SD';
  }
  return v === 'sd' ? 'SD' : r.toUpperCase();
}

export function mapPlexSession(s: PlexSession): StreamSession {
  const isEpisode = s.type === 'episode';
  const pad = (n: number | undefined) => String(n ?? 0).padStart(2, '0');
  const state =
    s.Player?.state === 'paused' ? 'paused' : s.Player?.state === 'buffering' ? 'buffering' : 'playing';
  return {
    id: s.Session?.id ?? s.sessionKey ?? '',
    user: s.User?.title ?? '',
    title: isEpisode ? (s.grandparentTitle ?? s.title ?? '') : (s.title ?? ''),
    subtitle: isEpisode ? `S${pad(s.parentIndex)}E${pad(s.index)} · ${s.title ?? ''}` : undefined,
    mediaType: s.type === 'movie' ? 'movie' : isEpisode ? 'episode' : s.type === 'track' ? 'track' : 'other',
    state,
    progress: s.duration && s.viewOffset !== undefined ? Math.min(1, s.viewOffset / s.duration) : 0,
    durationMs: s.duration ?? null,
    positionMs: s.viewOffset ?? null,
    transcoding: s.TranscodeSession?.videoDecision === 'transcode',
    device: s.Player?.title,
    client: s.Player?.product,
    resolution: resolution(s.Media?.[0]?.videoResolution),
  };
}

interface PlexSection {
  key?: string;
  title?: string;
  type?: string;
  Location?: Array<{ path?: string }>;
}

interface PlexItem {
  Media?: Array<{ videoResolution?: string; videoCodec?: string; Part?: Array<{ size?: number }> }>;
}

/** Plex type numbers: 1 movie, 2 show, 4 episode, 9 album. */
const PLEX_TYPES: Record<string, { kind: LibraryStats['kind']; titles: number; files: number | null }> = {
  movie: { kind: 'movie', titles: 1, files: 1 },
  show: { kind: 'show', titles: 2, files: 4 },
  artist: { kind: 'music', titles: 9, files: null },
};
const PAGE = 500;

export const plex = defineAdapter({
  id: 'plex',
  name: 'Plex',
  category: 'mediaServer',
  lifecycle: 'active',
  homepage: 'https://www.plex.tv',
  fields: [
    {
      key: 'token',
      kind: 'secret',
      label: 'adapters.fields.plexToken',
      help: 'adapters.help.plexToken',
      required: true,
    },
  ],
  credentials: z.object({ token: z.string().trim().min(1).max(256) }),
  capabilities: ['sessions', 'library'],
  create(ctx) {
    const headers = { 'X-Plex-Token': ctx.credentials.token, accept: 'application/json' };
    const get = async <T>(
      path: string,
      query?: Record<string, string | number>,
      extra?: Record<string, string>,
    ) => jsonOf<T>(await ctx.http.request({ path, query, headers: { ...headers, ...extra } }));
    type Container = {
      MediaContainer?: {
        totalSize?: number;
        size?: number;
        Metadata?: PlexItem[];
        Directory?: PlexSection[];
      };
    };
    return {
      async testConnection() {
        const res = await get<{ MediaContainer?: { version?: string } }>('/');
        const version = res.MediaContainer?.version;
        if (typeof version !== 'string') throw new AdapterError('badResponse', 'not a Plex server');
        return { version };
      },
      async sessions() {
        const res = await get<{ MediaContainer?: { Metadata?: PlexSession[] } }>('/status/sessions');
        return (res.MediaContainer?.Metadata ?? []).map(mapPlexSession);
      },
      async topology() {
        const sections = (await get<Container>('/library/sections')).MediaContainer?.Directory ?? [];
        return {
          links: [],
          folders: sections.flatMap((sec) =>
            (sec.Location ?? [])
              .filter((l) => typeof l.path === 'string' && l.path)
              .map((l) =>
                folder(
                  l.path!,
                  'library',
                  {},
                  { name: sec.title, kind: PLEX_TYPES[sec.type ?? '']?.kind ?? 'other' },
                ),
              ),
          ),
        };
      },
      async libraries() {
        const sections = (await get<Container>('/library/sections')).MediaContainer?.Directory ?? [];
        const out: LibraryStats[] = [];
        for (const sec of sections) {
          if (!sec.key) continue;
          const t = PLEX_TYPES[sec.type ?? ''];
          const lib = emptyLibrary(sec.key, sec.title ?? '', t?.kind ?? 'other');
          if (t) {
            const count = await get<Container>(
              `/library/sections/${sec.key}/all`,
              { type: t.titles },
              {
                'X-Plex-Container-Start': '0',
                'X-Plex-Container-Size': '0',
              },
            );
            lib.items = count.MediaContainer?.totalSize ?? count.MediaContainer?.size ?? 0;
          }
          if (t?.files) {
            for (let page = 0; page < MAX_LIBRARY_PAGES; page++) {
              const res = await get<Container>(
                `/library/sections/${sec.key}/all`,
                { type: t.files },
                {
                  'X-Plex-Container-Start': String(page * PAGE),
                  'X-Plex-Container-Size': String(PAGE),
                },
              );
              const items = res.MediaContainer?.Metadata ?? [];
              for (const item of items) {
                const media = item.Media?.[0];
                const size = media?.Part?.reduce((sum, p) => sum + (p.size ?? 0), 0);
                accumulate(lib, {
                  sizeBytes: media?.Part?.length ? (size ?? null) : null,
                  resolution: resolution(media?.videoResolution),
                  codec: normalizeCodec(media?.videoCodec),
                });
              }
              const total = res.MediaContainer?.totalSize ?? 0;
              if (items.length < PAGE || (page + 1) * PAGE >= total) break;
            }
          }
          out.push(lib);
        }
        return out;
      },
      webUrl: () => `${ctx.baseUrl}/web/index.html`,
    };
  },
});
