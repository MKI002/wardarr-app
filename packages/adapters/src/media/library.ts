// Shared helpers for media server library statistics.
import type { LibraryStats } from '@wardarr/core';

export const MAX_LIBRARY_PAGES = 200;

export interface FileFacts {
  sizeBytes: number | null;
  resolution: string | undefined;
  codec: string | undefined;
}

const CODEC_NAMES: Record<string, string> = {
  avc: 'h264',
  h264: 'h264',
  x264: 'h264',
  hevc: 'hevc',
  h265: 'hevc',
  x265: 'hevc',
  av1: 'av1',
  vp9: 'vp9',
  mpeg2video: 'mpeg2',
  mpeg4: 'mpeg4',
  vc1: 'vc1',
};

export function normalizeCodec(codec: string | undefined): string | undefined {
  if (!codec) return undefined;
  const c = codec.toLowerCase();
  return CODEC_NAMES[c] ?? c;
}

/** Collects file facts into the counters of one library. */
export function accumulate(lib: LibraryStats, f: FileFacts): void {
  lib.files++;
  if (f.sizeBytes !== null) lib.sizeBytes = (lib.sizeBytes ?? 0) + f.sizeBytes;
  const r = f.resolution ?? 'unknown';
  lib.resolutions[r] = (lib.resolutions[r] ?? 0) + 1;
  const c = f.codec ?? 'unknown';
  lib.videoCodecs[c] = (lib.videoCodecs[c] ?? 0) + 1;
}

export function emptyLibrary(id: string, name: string, kind: LibraryStats['kind']): LibraryStats {
  return { id, name, kind, items: 0, files: 0, sizeBytes: null, resolutions: {}, videoCodecs: {} };
}
