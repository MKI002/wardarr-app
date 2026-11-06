// Plex Media Server. Uses an X-Plex-Token instead of an API key.
import { AdapterError, defineAdapter, type StreamSession } from '@wardarr/core';
import { z } from 'zod';
import { jsonOf } from '../shared/http.js';

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
  if (r === '4k') return '4K';
  if (/^\d+$/.test(r)) return `${r}p`;
  return r.toUpperCase();
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
  capabilities: ['sessions'],
  create(ctx) {
    const headers = { 'X-Plex-Token': ctx.credentials.token, accept: 'application/json' };
    const get = async <T>(path: string) => jsonOf<T>(await ctx.http.request({ path, headers }));
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
      webUrl: () => `${ctx.baseUrl}/web/index.html`,
    };
  },
});
