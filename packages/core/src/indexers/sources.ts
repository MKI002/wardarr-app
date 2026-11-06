// Where do the indexers of each *arr app come from? Prowlarr syncs indexers
// into Sonarr, Radarr and friends as Newznab/Torznab entries that point back
// at Prowlarr (`<prowlarr>/<id>/`, named `<indexer> (Prowlarr)`). Anything
// else was added in the app by hand. This module tells the two apart, links
// synced entries to their Prowlarr indexer and finds duplicates, entries
// Prowlarr should have synced but did not, and leftovers of deleted indexers.
import type { ArrIndexerInfo, IndexerApp, IndexerInfo } from '../adapter/types.js';

export interface ProwlarrSide {
  instanceId: string;
  instanceName: string;
  baseUrl: string;
  indexers: IndexerInfo[];
  apps: IndexerApp[];
}

export interface ArrSide {
  instanceId: string;
  instanceName: string;
  adapter: string;
  baseUrl: string;
  /** Null when the app could not be read. */
  indexers: ArrIndexerInfo[] | null;
}

export type IndexerSource = 'prowlarr' | 'direct';
export type IndexerFlag = 'duplicate' | 'orphan' | 'searchOff' | 'unknownProwlarr';

export interface ProwlarrRef {
  instanceId: string;
  indexerId: number;
}

export interface ClassifiedIndexer extends ArrIndexerInfo {
  source: IndexerSource;
  /** How the source was recognised: the address points at Prowlarr, or only the name says so. */
  evidence: 'url' | 'name' | 'none';
  prowlarr: ProwlarrRef | null;
  /** Shared key of the site across apps, see `Tracker`. */
  key: string;
  flags: IndexerFlag[];
  /** Other entries in the same app that reach the same site. */
  duplicateOf: string[];
}

export interface MissingIndexer {
  key: string;
  name: string;
  prowlarr: ProwlarrRef;
}

export type ArrMode = 'prowlarr' | 'direct' | 'mixed' | 'none' | 'unknown';

export interface ArrSourceReport {
  instanceId: string;
  instanceName: string;
  adapter: string;
  mode: ArrMode;
  /** The Prowlarr application entry that feeds this app, if any. */
  prowlarrApp: {
    prowlarrInstanceId: string;
    prowlarrName: string;
    appId: number;
    appName: string;
    syncLevel: IndexerApp['syncLevel'] | null;
  } | null;
  indexers: ClassifiedIndexer[];
  missing: MissingIndexer[];
  counts: {
    total: number;
    synced: number;
    direct: number;
    duplicate: number;
    missing: number;
    orphan: number;
    searchOff: number;
  };
}

/** One site, however many apps and copies it appears in. */
export interface Tracker {
  key: string;
  name: string;
  protocol: 'usenet' | 'torrent' | 'unknown';
  privacy: IndexerInfo['privacy'] | null;
  prowlarr: ProwlarrRef | null;
  /** Enabled in Prowlarr (true for direct-only sites). */
  enabled: boolean;
}

export type CellState = 'synced' | 'direct' | 'both' | 'missing' | 'off';

export interface SourceAnalysis {
  arrs: ArrSourceReport[];
  trackers: Tracker[];
  cells: Array<{ key: string; instanceId: string; state: CellState }>;
  /** Prowlarr applications that point at an app Wardarr does not know. */
  unmatchedApps: Array<{ prowlarrInstanceId: string; appId: number; name: string; implementation: string }>;
}

// ----------------------------------------------------------------- helpers

const SUFFIX = '(prowlarr)';

/** Whether a name ends in the `(Prowlarr)` that Prowlarr adds to synced entries. */
function hasProwlarrSuffix(name: string): boolean {
  return name.trim().toLowerCase().endsWith(SUFFIX);
}

/** The name without the `(Prowlarr)` suffix. String checks, no regex: names come from the apps. */
export function stripProwlarrSuffix(name: string): string {
  const trimmed = name.trim();
  return hasProwlarrSuffix(trimmed) ? trimmed.slice(0, -SUFFIX.length).trim() : trimmed;
}

/** Lowercase name without the `(Prowlarr)` suffix, domain ending and punctuation. */
export function normalizeIndexerName(name: string): string {
  return stripProwlarrSuffix(name)
    .toLowerCase()
    .replace(/\.(com|org|net|info|io|me|cc|to|ws|xyz|club|li|se|eu|tv|nl|de)$/, '')
    .replace(/[^a-z0-9]+/g, '');
}

export interface Address {
  host: string;
  port: string;
  path: string;
}

/** Host (lowercase), port (scheme default when missing) and path without trailing slash. */
export function parseIndexerAddress(url: string | null | undefined): Address | null {
  if (!url) return null;
  try {
    const u = new URL(url.includes('://') ? url : `http://${url}`);
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    return { host: u.hostname.toLowerCase(), port, path: u.pathname.replace(/\/+$/, '') };
  } catch {
    return null;
  }
}

const sameHost = (a: Address, b: Address) => a.host === b.host && a.port === b.port;

/**
 * The Prowlarr indexer id an *arr entry points at, when its address is
 * `<base>/<id>` or `<base>/<id>/api` below one of the Prowlarr bases.
 */
function prowlarrIdFromUrl(url: Address, bases: Address[]): number | null {
  for (const base of bases) {
    if (!sameHost(url, base)) continue;
    const rest = url.path.startsWith(base.path) ? url.path.slice(base.path.length) : null;
    const m = rest?.match(/^\/(\d+)(?:\/api)?$/);
    if (m) return Number(m[1]);
  }
  return null;
}

/** Category families (2000 movies, 5000 TV, ...) so sub categories match their parent. */
const families = (ids: number[]) => new Set(ids.map((c) => Math.floor(c / 1000)));

/**
 * The Prowlarr application entry that feeds an app: same host and port
 * (exact path first), then the same name. Entries of another product are
 * never matched, and a tie matches nothing.
 */
function matchApp(arr: ArrSide, prowlarrs: ProwlarrSide[]) {
  const addr = parseIndexerAddress(arr.baseUrl);
  const product = arr.adapter.toLowerCase();
  const all = prowlarrs
    .flatMap((p) => p.apps.map((app) => ({ p, app })))
    .filter(({ app }) => !app.implementation || app.implementation.toLowerCase() === product);
  const name = normalizeIndexerName(arr.instanceName);
  const one = <T>(list: T[]) => (list.length === 1 ? list[0]! : null);
  if (addr) {
    const byHost = all.filter(({ app }) => {
      const a = parseIndexerAddress(app.baseUrl);
      return !!a && sameHost(a, addr);
    });
    const exact = byHost.filter(({ app }) => parseIndexerAddress(app.baseUrl)!.path === addr.path);
    // Several apps can share one host behind a proxy, so a different path only
    // matches together with the same name.
    const hit = one(exact) ?? one(byHost.filter(({ app }) => normalizeIndexerName(app.name) === name));
    if (hit) return hit;
    if (byHost.length > 0) return null;
  }
  return one(all.filter(({ app }) => normalizeIndexerName(app.name) === name));
}

// ------------------------------------------------------------------ main

export function analyzeSources(prowlarrs: ProwlarrSide[], arrs: ArrSide[]): SourceAnalysis {
  const trackers = new Map<string, Tracker>();
  const prowlarrKey = (ref: ProwlarrRef) => `p:${ref.instanceId}:${ref.indexerId}`;

  // Every Prowlarr indexer is a tracker, synced anywhere or not.
  const prowlarrByName = new Map<string, ProwlarrRef[]>();
  const prowlarrHosts: Array<{ ref: ProwlarrRef; hosts: Address[] }> = [];
  for (const p of prowlarrs) {
    for (const ix of p.indexers) {
      const ref = { instanceId: p.instanceId, indexerId: ix.id };
      trackers.set(prowlarrKey(ref), {
        key: prowlarrKey(ref),
        name: ix.name,
        protocol: ix.protocol,
        privacy: ix.privacy ?? null,
        prowlarr: ref,
        enabled: ix.enabled,
      });
      const n = normalizeIndexerName(ix.name);
      prowlarrByName.set(n, [...(prowlarrByName.get(n) ?? []), ref]);
      prowlarrHosts.push({
        ref,
        hosts: (ix.urls ?? []).map(parseIndexerAddress).filter((a): a is Address => !!a),
      });
    }
  }
  const findProwlarr = (ref: ProwlarrRef) =>
    prowlarrs.find((p) => p.instanceId === ref.instanceId)?.indexers.find((i) => i.id === ref.indexerId);

  const cells: SourceAnalysis['cells'] = [];
  const matchedApps = new Set<string>();

  const reports = arrs.map((arr): ArrSourceReport => {
    const app = matchApp(arr, prowlarrs);
    if (app) matchedApps.add(`${app.p.instanceId}:${app.app.id}`);
    const prowlarrApp = app
      ? {
          prowlarrInstanceId: app.p.instanceId,
          prowlarrName: app.p.instanceName,
          appId: app.app.id,
          appName: app.app.name,
          syncLevel: app.app.syncLevel ?? null,
        }
      : null;
    if (!arr.indexers) {
      return {
        instanceId: arr.instanceId,
        instanceName: arr.instanceName,
        adapter: arr.adapter,
        mode: 'unknown',
        prowlarrApp,
        indexers: [],
        missing: [],
        counts: { total: 0, synced: 0, direct: 0, duplicate: 0, missing: 0, orphan: 0, searchOff: 0 },
      };
    }

    // Addresses under which this app reaches Prowlarr. The app entry's
    // `prowlarrUrl` is what Prowlarr writes into synced indexers.
    const bases = [
      ...(app?.app.prowlarrUrl ? [{ p: app.p, url: app.app.prowlarrUrl }] : []),
      ...prowlarrs.flatMap((p) => [
        { p, url: p.baseUrl },
        ...p.apps.flatMap((a) => (a.prowlarrUrl ? [{ p, url: a.prowlarrUrl }] : [])),
      ]),
    ]
      .map((b) => ({ p: b.p, addr: parseIndexerAddress(b.url) }))
      .filter((b): b is { p: ProwlarrSide; addr: Address } => !!b.addr);

    const classified = arr.indexers.map((ix): ClassifiedIndexer => {
      const flags: IndexerFlag[] = [];
      if (!ix.enableRss && !ix.enableAutomaticSearch && !ix.enableInteractiveSearch) flags.push('searchOff');
      const addr = parseIndexerAddress(ix.baseUrl);
      let ref: ProwlarrRef | null = null;
      let evidence: ClassifiedIndexer['evidence'] = 'none';
      if (addr) {
        for (const b of bases) {
          const id = prowlarrIdFromUrl(addr, [b.addr]);
          if (id !== null) {
            ref = { instanceId: b.p.instanceId, indexerId: id };
            evidence = 'url';
            break;
          }
        }
      }
      const named = hasProwlarrSuffix(ix.name);
      if (!ref && named) {
        evidence = 'name';
        const candidates = prowlarrByName.get(normalizeIndexerName(ix.name)) ?? [];
        ref =
          candidates.find((c) => c.instanceId === app?.p.instanceId) ??
          (candidates.length === 1 ? candidates[0]! : null);
        if (!ref && (addr === null || !bases.some((b) => sameHost(addr, b.addr))))
          flags.push('unknownProwlarr');
      }
      const source: IndexerSource = evidence === 'none' ? 'direct' : 'prowlarr';
      if (source === 'prowlarr' && ref && !findProwlarr(ref)) {
        flags.push('orphan');
      }

      let key: string;
      if (ref && findProwlarr(ref)) key = prowlarrKey(ref);
      else if (source === 'prowlarr' && ref) key = prowlarrKey(ref);
      else {
        // A direct entry may still be a site Prowlarr also knows.
        const n = normalizeIndexerName(ix.name);
        const byName = prowlarrByName.get(n);
        const byHost = addr ? prowlarrHosts.find((h) => h.hosts.some((a) => sameHost(a, addr))) : undefined;
        const known = byHost?.ref ?? (byName && byName.length > 0 ? byName[0] : undefined);
        key = known ? prowlarrKey(known) : `d:${n || ix.id}`;
      }
      if (!trackers.has(key)) {
        trackers.set(key, {
          key,
          name: stripProwlarrSuffix(ix.name),
          protocol: ix.protocol,
          privacy: null,
          prowlarr: source === 'prowlarr' ? ref : null,
          enabled: true,
        });
      }
      return { ...ix, source, evidence, prowlarr: ref, key, flags, duplicateOf: [] };
    });

    // Two entries for the same site: the app searches it twice.
    const byKey = new Map<string, ClassifiedIndexer[]>();
    for (const c of classified) byKey.set(c.key, [...(byKey.get(c.key) ?? []), c]);
    for (const group of byKey.values()) {
      const active = group.filter((c) => !c.flags.includes('searchOff'));
      if (active.length < 2) continue;
      for (const c of active) {
        c.flags.push('duplicate');
        c.duplicateOf = active.filter((o) => o !== c).map((o) => o.name);
      }
    }

    // Indexers Prowlarr is meant to sync here but the app does not have.
    const missing: MissingIndexer[] = [];
    if (app && app.app.enabled && app.app.syncLevel !== 'disabled') {
      const present = new Set(
        classified
          .filter((c) => c.prowlarr?.instanceId === app.p.instanceId)
          .map((c) => c.prowlarr!.indexerId),
      );
      const appFamilies = families(app.app.syncCategories ?? []);
      for (const id of app.app.indexerIds) {
        if (present.has(id)) continue;
        const ix = app.p.indexers.find((i) => i.id === id);
        if (!ix || !ix.enabled) continue;
        // Prowlarr skips indexers without a category the app syncs.
        if (appFamilies.size > 0 && ix.categories && ix.categories.length > 0) {
          const own = families(ix.categories);
          if (![...own].some((f) => appFamilies.has(f))) continue;
        }
        const ref = { instanceId: app.p.instanceId, indexerId: id };
        missing.push({ key: prowlarrKey(ref), name: ix.name, prowlarr: ref });
      }
    }

    for (const [key, group] of byKey) {
      const sources = new Set(group.map((c) => c.source));
      const allOff = group.every((c) => c.flags.includes('searchOff'));
      const state: CellState = allOff
        ? 'off'
        : group.some((c) => c.flags.includes('duplicate'))
          ? 'both'
          : sources.has('prowlarr')
            ? 'synced'
            : 'direct';
      cells.push({ key, instanceId: arr.instanceId, state });
    }
    for (const m of missing) cells.push({ key: m.key, instanceId: arr.instanceId, state: 'missing' });

    const synced = classified.filter((c) => c.source === 'prowlarr').length;
    const direct = classified.length - synced;
    const mode: ArrMode =
      classified.length === 0
        ? 'none'
        : synced > 0 && direct > 0
          ? 'mixed'
          : synced > 0
            ? 'prowlarr'
            : 'direct';
    return {
      instanceId: arr.instanceId,
      instanceName: arr.instanceName,
      adapter: arr.adapter,
      mode,
      prowlarrApp,
      indexers: classified,
      missing,
      counts: {
        total: classified.length,
        synced,
        direct,
        duplicate: classified.filter((c) => c.flags.includes('duplicate')).length,
        missing: missing.length,
        orphan: classified.filter((c) => c.flags.includes('orphan')).length,
        searchOff: classified.filter((c) => c.flags.includes('searchOff')).length,
      },
    };
  });

  const unmatchedApps = prowlarrs.flatMap((p) =>
    p.apps
      .filter((a) => !matchedApps.has(`${p.instanceId}:${a.id}`))
      .map((a) => ({
        prowlarrInstanceId: p.instanceId,
        appId: a.id,
        name: a.name,
        implementation: a.implementation,
      })),
  );

  return { arrs: reports, trackers: [...trackers.values()], cells, unmatchedApps };
}
