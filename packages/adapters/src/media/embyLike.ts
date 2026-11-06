// Jellyfin and Emby share the session API inherited from Emby.
import { AdapterError, type AdapterContext, type AdapterInstance, type StreamSession } from '@wardarr/core';
import { jsonOf } from '../shared/http.js';

const TICKS_PER_MS = 10_000;

interface SessionInfo {
  Id: string;
  UserName?: string;
  Client?: string;
  DeviceName?: string;
  NowPlayingItem?: {
    Name?: string;
    SeriesName?: string;
    Type?: string;
    RunTimeTicks?: number;
    IndexNumber?: number;
    ParentIndexNumber?: number;
    Width?: number;
    Height?: number;
  };
  PlayState?: { PositionTicks?: number; IsPaused?: boolean };
  TranscodingInfo?: { IsVideoDirect?: boolean; IsAudioDirect?: boolean } | null;
  PlayMethod?: string;
}

export function resolutionLabel(height: number | undefined): string | undefined {
  if (!height) return undefined;
  if (height >= 2000) return '4K';
  if (height >= 1000) return '1080p';
  if (height >= 700) return '720p';
  return 'SD';
}

export function mapSession(s: SessionInfo): StreamSession | null {
  const item = s.NowPlayingItem;
  if (!item) return null;
  const durationMs = item.RunTimeTicks ? item.RunTimeTicks / TICKS_PER_MS : null;
  const positionMs =
    s.PlayState?.PositionTicks !== undefined ? s.PlayState.PositionTicks / TICKS_PER_MS : null;
  const isEpisode = item.Type === 'Episode';
  const pad = (n: number | undefined) => String(n ?? 0).padStart(2, '0');
  return {
    id: s.Id,
    user: s.UserName ?? '',
    title: isEpisode && item.SeriesName ? item.SeriesName : (item.Name ?? ''),
    subtitle: isEpisode
      ? `S${pad(item.ParentIndexNumber)}E${pad(item.IndexNumber)} · ${item.Name ?? ''}`
      : undefined,
    mediaType:
      item.Type === 'Movie' ? 'movie' : isEpisode ? 'episode' : item.Type === 'Audio' ? 'track' : 'other',
    state: s.PlayState?.IsPaused ? 'paused' : 'playing',
    progress: durationMs && positionMs !== null ? Math.min(1, positionMs / durationMs) : 0,
    durationMs,
    positionMs,
    transcoding:
      s.PlayMethod === 'Transcode' || (!!s.TranscodingInfo && s.TranscodingInfo.IsVideoDirect === false),
    device: s.DeviceName,
    client: s.Client,
    resolution: resolutionLabel(item.Height),
  };
}

export function createEmbyLike(
  ctx: AdapterContext<{ apiKey: string }>,
  opts: {
    prefix: string;
    headers: Record<string, string>;
    productCheck: (info: Record<string, unknown>) => boolean;
  },
): AdapterInstance {
  const get = async <T>(path: string, query?: Record<string, string | number>) =>
    jsonOf<T>(await ctx.http.request({ path: `${opts.prefix}${path}`, query, headers: opts.headers }));

  return {
    async testConnection() {
      const info = await get<Record<string, unknown>>('/System/Info');
      if (typeof info.Version !== 'string' || !opts.productCheck(info))
        throw new AdapterError('badResponse', 'unexpected server');
      return {
        version: info.Version,
        product: typeof info.ProductName === 'string' ? info.ProductName : undefined,
      };
    },
    async sessions() {
      const list = await get<SessionInfo[]>('/Sessions', { ActiveWithinSeconds: 960 });
      return list.map(mapSession).filter((s): s is StreamSession => s !== null);
    },
    webUrl(target) {
      return `${ctx.baseUrl}${target?.kind === 'settings' || target?.kind === 'system' ? '/web/#/dashboard' : '/web/'}`;
    },
  };
}
