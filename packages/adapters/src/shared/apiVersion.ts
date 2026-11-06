// Version detection for *arr style APIs (Sonarr, Radarr, Lidarr, Readarr,
// Whisparr, Prowlarr). Each product reports its version and the API versions
// it offers; Wardarr picks the newest API version both sides speak, and
// notices when the product moves on so it can detect again.
import { AdapterError, type AdapterContext, type InstanceRef, type Signal } from '@wardarr/core';

export interface VersionProfile {
  /** API versions Wardarr implements for this product, newest first, e.g. `['v3']`. */
  apis: readonly string[];
  /** Product major versions Wardarr was tested with. */
  testedMajors: { min: number; max: number };
}

export interface ApiDetection {
  /** Chosen API version, for example `v3`. */
  api: string;
  apiBase: string;
  productVersion: string | null;
  productName: string | null;
  /** API versions the product offers, if it says so. */
  offered: string[];
  /** Set when Wardarr runs in compatibility mode. */
  compat: { reason: 'untestedVersion' | 'newerApi' | 'both'; newestOffered: string | null } | null;
}

interface ApiInfo {
  current?: string;
  deprecated?: string[];
}

interface StatusInfo {
  version?: string;
  appName?: string;
}

const apiNumber = (v: string) => Number(v.replace(/^v/i, '')) || 0;
export const majorOf = (version: string | null | undefined) => Number((version ?? '').split('.')[0]) || 0;

/**
 * Detects the API version. `GET /api` lists the offered versions on current
 * releases; older ones lack it, so Wardarr then probes the versions it knows.
 */
export async function detectApi(
  ctx: AdapterContext<{ apiKey: string }>,
  profile: VersionProfile,
): Promise<ApiDetection> {
  const headers = { 'X-Api-Key': ctx.credentials.apiKey };
  let offered: string[] = [];
  try {
    const res = await ctx.http.request({ path: '/api', headers });
    if (res.status >= 200 && res.status < 300) {
      const info = res.json<ApiInfo>();
      if (info && typeof info.current === 'string') {
        offered = [info.current, ...(Array.isArray(info.deprecated) ? info.deprecated : [])].map((v) =>
          v.toLowerCase(),
        );
      }
    }
  } catch (err) {
    // Connection problems surface on the probe below with their real kind.
    if (!(err instanceof AdapterError) || err.kind === 'blocked') throw err;
  }

  const preferred = offered.length ? profile.apis.filter((a) => offered.includes(a)) : [];
  const order = [...preferred, ...profile.apis.filter((a) => !preferred.includes(a))];
  let lastError: unknown = new AdapterError('unsupported', 'no known API version answered');
  for (const api of order) {
    const apiBase = `/api/${api}`;
    const res = await ctx.http.request({ path: `${apiBase}/system/status`, headers });
    if (res.status === 401 || res.status === 403)
      throw new AdapterError('unauthorized', `HTTP ${res.status}`, res.status);
    if (res.status === 404) {
      lastError = new AdapterError('unsupported', `API ${api} not offered`, 404);
      continue;
    }
    if (res.status < 200 || res.status >= 300)
      throw new AdapterError('badResponse', `HTTP ${res.status}`, res.status);
    let status: StatusInfo;
    try {
      status = res.json<StatusInfo>();
    } catch {
      throw new AdapterError('badResponse', 'not an *arr API');
    }
    if (!status || typeof status.version !== 'string')
      throw new AdapterError('badResponse', 'not an *arr API');
    const newer = offered
      .filter((o) => !profile.apis.includes(o) && apiNumber(o) > apiNumber(api))
      .sort((a, b) => apiNumber(b) - apiNumber(a));
    const untested =
      majorOf(status.version) > profile.testedMajors.max ||
      majorOf(status.version) < profile.testedMajors.min;
    const compat: ApiDetection['compat'] =
      untested || newer.length
        ? {
            reason: untested && newer.length ? 'both' : untested ? 'untestedVersion' : 'newerApi',
            newestOffered: newer[0] ?? null,
          }
        : null;
    return {
      api,
      apiBase,
      productVersion: status.version,
      productName: typeof status.appName === 'string' ? status.appName : null,
      offered,
      compat,
    };
  }
  throw lastError;
}

/** A Wardarr notice when an instance runs in compatibility mode. */
export function compatSignal(d: ApiDetection, instance: InstanceRef, product: string): Signal | null {
  if (!d.compat) return null;
  return {
    origin: 'wardarr',
    instance,
    kind: 'health',
    source: 'Wardarr.apiCompatibility',
    level: 'info',
    message: `${product} ${d.productVersion ?? ''} uses API ${d.api} in compatibility mode`.replace(
      /\s+/g,
      ' ',
    ),
    data: {
      product,
      productVersion: d.productVersion ?? '',
      api: d.api,
      reason: d.compat.reason,
      newestOffered: d.compat.newestOffered ?? '',
    },
  };
}

/**
 * Caches a detection and drops it when the product version changes or an
 * endpoint suddenly answers 404, so the next call detects again.
 */
export function detectionCache(detect: () => Promise<ApiDetection>) {
  let cached: Promise<ApiDetection> | null = null;
  return {
    get(): Promise<ApiDetection> {
      cached ??= detect().catch((err) => {
        cached = null;
        throw err;
      });
      return cached;
    },
    reset(): void {
      cached = null;
    },
    /** Compares a freshly reported version with the cached one. */
    async noteVersion(version: string | null | undefined): Promise<boolean> {
      if (!cached || !version) return false;
      const d = await cached.catch(() => null);
      if (d && d.productVersion !== version) {
        cached = null;
        return true;
      }
      return false;
    },
  };
}
