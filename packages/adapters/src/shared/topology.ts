// Helpers for the stack map: turn what a service reports about its
// neighbours into links and folders. Every part is read on its own, so a
// missing endpoint only drops that part.
import type { ServiceLink, StorageFolder } from '@wardarr/core';

/** Implementation names as the *arr apps, Prowlarr and Seerr report them, mapped to adapter ids. */
const PRODUCTS: Record<string, string[]> = {
  qbittorrent: ['qbittorrent'],
  sabnzbd: ['sabnzbd'],
  transmission: ['transmission'],
  deluge: ['deluge'],
  nzbget: ['nzbget'],
  sonarr: ['sonarr'],
  radarr: ['radarr'],
  lidarr: ['lidarr'],
  readarr: ['readarr'],
  whisparr: ['whisparr'],
  plexserver: ['plex'],
  plex: ['plex'],
  // "Emby / Jellyfin" in the *arr apps.
  mediabrowser: ['jellyfin', 'emby'],
  jellyfin: ['jellyfin'],
  emby: ['emby'],
};

export function productsOf(implementation: string): string[] {
  return PRODUCTS[implementation.toLowerCase().replace(/[^a-z]/g, '')] ?? [];
}

interface Field {
  name?: string;
  value?: unknown;
}

export function fieldValue(fields: Field[] | undefined, name: string): unknown {
  return fields?.find((f) => f.name === name)?.value;
}

/** Builds an address from host parts. Never includes credentials. */
export function addressOf(parts: {
  host?: unknown;
  port?: unknown;
  ssl?: unknown;
  base?: unknown;
}): string | null {
  const raw = typeof parts.host === 'string' ? parts.host.trim() : '';
  if (!raw) return null;
  // Some services store a full URL in the host field.
  if (/^https?:\/\//i.test(raw)) return stripCredentials(raw);
  const port = typeof parts.port === 'number' || typeof parts.port === 'string' ? String(parts.port) : '';
  const base = typeof parts.base === 'string' && parts.base.trim() ? parts.base.trim() : '';
  const scheme = parts.ssl === true ? 'https' : 'http';
  const path = base ? `/${base.replace(/^\/+|\/+$/g, '')}` : '';
  return stripCredentials(`${scheme}://${raw}${port ? `:${port}` : ''}${path}`);
}

export function stripCredentials(url: string): string | null {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** Runs one read and returns a fallback when it fails. */
export async function part<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export function link(
  kind: ServiceLink['kind'],
  implementation: string,
  name: string,
  url: string | null,
  enabled: boolean,
  extra: Partial<ServiceLink> = {},
): ServiceLink {
  return { kind, products: productsOf(implementation), implementation, name, url, enabled, ...extra };
}

interface DiskSpace {
  path?: string;
  freeSpace?: number;
  totalSpace?: number;
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() || '/';

/** Finds the mount of a folder: the longest disk path that contains it. */
export function mountOf(path: string, disks: DiskSpace[]): DiskSpace | undefined {
  const p = norm(path);
  let best: DiskSpace | undefined;
  for (const d of disks) {
    if (typeof d.path !== 'string') continue;
    const m = norm(d.path);
    const inside = m === '/' || p === m || p.startsWith(`${m}/`);
    if (inside && (!best || norm(best.path ?? '').length < m.length)) best = d;
  }
  return best;
}

export function folder(
  path: string,
  use: StorageFolder['use'],
  space: { free?: unknown; total?: unknown; mount?: unknown },
  extra: Partial<StorageFolder> = {},
): StorageFolder {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  return {
    path,
    use,
    freeBytes: n(space.free),
    totalBytes: n(space.total),
    ...(typeof space.mount === 'string' && space.mount ? { mount: space.mount } : {}),
    ...extra,
  };
}
