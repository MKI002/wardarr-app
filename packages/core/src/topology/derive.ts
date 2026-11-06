// Derives the stack map from what each service reports about its neighbours.
// Nothing here assumes a particular setup: every edge comes from a link or a
// folder a service reported, and the way Wardarr matched it is kept, so the
// UI can tell certain connections from likely ones.
import type { AdapterCategory, LinkKind, ServiceTopology, StorageFolder } from '../adapter/types.js';

export interface TopologyInput {
  id: string;
  name: string;
  /** Adapter id, for example `sonarr`. */
  adapter: string;
  category: AdapterCategory;
  baseUrl: string;
  enabled: boolean;
  /** Null when the service was not read (disabled, down or unsupported). */
  topology: ServiceTopology | null;
}

/** Columns of the map, from where requests and releases come in to where media is watched. */
export type MapLayer = 0 | 1 | 2 | 3 | 4;

/** How Wardarr knows two nodes are connected. */
export type MatchKind = 'address' | 'name' | 'product' | 'path' | 'space' | 'kind' | 'self';

export interface StorageMember {
  instanceId: string;
  path: string;
  use: StorageFolder['use'];
  name?: string;
  kind?: StorageFolder['kind'];
  accessible?: boolean;
  match: MatchKind;
}

export interface MapNode {
  id: string;
  type: 'instance' | 'ghost' | 'storage';
  layer: MapLayer;
  name: string;
  /** Adapter id for instances, likely product for ghosts. */
  adapter: string | null;
  instanceId?: string;
  /** Ghosts: implementation and address as the reporting service has them. */
  implementation?: string;
  address?: string | null;
  storage?: {
    freeBytes: number | null;
    totalBytes: number | null;
    mount: string | null;
    members: StorageMember[];
  };
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  kind: LinkKind | 'storage';
  /** Names the link has in the reporting service. */
  labels: string[];
  enabled: boolean;
  match: MatchKind;
  /** False when Wardarr inferred the other side, for example from the product alone. */
  confident: boolean;
  /** The two ends are already joined through a shared storage node. */
  redundant?: boolean;
  indexerIds?: number[];
  is4k?: boolean;
  use?: StorageFolder['use'];
}

export interface StackGraph {
  nodes: MapNode[];
  edges: MapEdge[];
}

const SOURCE_ADAPTERS = new Set(['bazarr']);

export function layerOf(category: AdapterCategory | 'storage', adapter?: string | null): MapLayer {
  if (adapter && SOURCE_ADAPTERS.has(adapter)) return 0;
  switch (category) {
    case 'indexer':
    case 'requests':
      return 0;
    case 'arr':
      return 1;
    case 'downloader':
      return 2;
    case 'storage':
      return 3;
    // Transcoders work on the stored media, next to the media servers.
    case 'mediaServer':
    case 'transcoder':
      return 4;
  }
}

const KIND_LAYER: Record<LinkKind, MapLayer> = {
  indexers: 1,
  requests: 1,
  subtitles: 1,
  downloads: 2,
  mediaServer: 4,
  libraryUpdate: 4,
};

// ------------------------------------------------------------- addresses

interface Address {
  host: string;
  port: string;
  path: string;
}

export function parseAddress(url: string | null | undefined): Address | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    return { host: u.hostname.toLowerCase(), port, path: u.pathname.replace(/\/+$/, '').toLowerCase() };
  } catch {
    return null;
  }
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

interface Match {
  instance: TopologyInput;
  match: MatchKind;
  confident: boolean;
}

/**
 * Finds the connected instance a reported link points to. The address wins,
 * then the name, then being the only instance of that product.
 */
export function matchLink(
  link: { products: string[]; name: string; url: string | null },
  instances: TopologyInput[],
  reporterId: string,
): Match | null {
  const candidates = instances.filter((i) => i.id !== reporterId && link.products.includes(i.adapter));
  if (candidates.length === 0) return null;
  const target = parseAddress(link.url);
  const name = slug(link.name);
  const scored = candidates.map((instance) => {
    const own = parseAddress(instance.baseUrl);
    const iname = slug(instance.name);
    let score = 0;
    let match: MatchKind = 'product';
    if (target && own && target.host === own.host && target.port === own.port) {
      score = target.path === own.path ? 100 : 90;
      match = 'address';
    } else if (name && name === iname) {
      score = 70;
      match = 'name';
    } else if (candidates.length === 1) {
      score = 40;
      match = 'product';
    } else if (name && iname && (name.includes(iname) || iname.includes(name))) {
      // Partial names only decide when nothing better exists; a shorter
      // overlap scores lower, so "Radarr" prefers "Radarr" over "Radarr 4K".
      score = 30 - Math.abs(name.length - iname.length) / 100;
      match = 'name';
    }
    return { instance, score, match };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]!;
  if (best.score === 0) return null;
  if (scored[1] && scored[1].score === best.score) return null;
  return { instance: best.instance, match: best.match, confident: best.score >= 70 };
}

// --------------------------------------------------------------- storage

interface FolderRef extends StorageFolder {
  instanceId: string;
  adapter: string;
}

const normPath = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() || '/';
const segments = (p: string) => normPath(p).split('/').filter(Boolean);

function commonTail(a: string, b: string): number {
  const x = segments(a);
  const y = segments(b);
  let n = 0;
  while (n < x.length && n < y.length && x[x.length - 1 - n] === y[y.length - 1 - n]) n++;
  return n;
}

const GB = 1024 ** 3;

/** Two folders sit on the same disk when the disk sizes and free space agree. */
function sameDisk(a: FolderRef, b: FolderRef): boolean {
  if (a.totalBytes !== null && b.totalBytes !== null) {
    const tol = Math.max(a.totalBytes * 0.002, 0.02 * GB);
    if (Math.abs(a.totalBytes - b.totalBytes) > tol) return false;
    if (a.freeBytes !== null && b.freeBytes !== null)
      return Math.abs(a.freeBytes - b.freeBytes) <= Math.max(a.totalBytes * 0.03, GB);
    return true;
  }
  // Only free space is known: it has to agree closely.
  if (a.freeBytes !== null && b.freeBytes !== null && a.freeBytes > GB) {
    return Math.abs(a.freeBytes - b.freeBytes) <= Math.max(a.freeBytes * 0.001, 0.25 * GB);
  }
  return false;
}

const kindsFit = (a?: StorageFolder['kind'], b?: StorageFolder['kind']) =>
  !a || !b || a === 'other' || b === 'other' || a === b;

class UnionFind {
  private readonly parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]!]!;
      i = this.parent[i]!;
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

function commonPrefix(paths: string[]): string | null {
  if (paths.length === 0) return null;
  const parts = paths.map((p) => p.replace(/\\/g, '/').split('/'));
  const first = parts[0]!;
  let n = 0;
  while (n < first.length && parts.every((p) => p[n] === first[n])) n++;
  const prefix = first.slice(0, n).join('/');
  return prefix && prefix !== '/' ? prefix : null;
}

function clusterFolders(folders: FolderRef[]): Array<{ members: FolderRef[]; match: MatchKind[] }> {
  const uf = new UnionFind(folders.length);
  const match: MatchKind[] = folders.map(() => 'self');
  const strongest = (i: number, m: MatchKind) => {
    const rank: MatchKind[] = ['self', 'space', 'path', 'kind'];
    // Keep the first, most certain reason a folder joined.
    if (match[i] === 'self' || rank.indexOf(m) < rank.indexOf(match[i]!)) match[i] = m;
  };

  // 1. Same disk by size and free space, also across services.
  for (let i = 0; i < folders.length; i++)
    for (let j = i + 1; j < folders.length; j++)
      if (sameDisk(folders[i]!, folders[j]!)) {
        uf.union(i, j);
        if (folders[i]!.instanceId !== folders[j]!.instanceId) {
          strongest(i, 'space');
          strongest(j, 'space');
        }
      }

  // 2. Folders of one service on the same mount belong together.
  for (let i = 0; i < folders.length; i++)
    for (let j = i + 1; j < folders.length; j++) {
      const a = folders[i]!;
      const b = folders[j]!;
      if (a.instanceId === b.instanceId && a.mount && a.mount === b.mount) uf.union(i, j);
    }

  // 3. Media server libraries without space figures: match the *arr root
  //    folder with the longest common path tail and a fitting media kind.
  const known = folders.map((f, i) => ({ f, i })).filter(({ f }) => f.use !== 'library');
  for (let i = 0; i < folders.length; i++) {
    const lib = folders[i]!;
    if (lib.use !== 'library') continue;
    let best = 0;
    let hits: number[] = [];
    for (const { f, i: j } of known) {
      if (f.use !== 'media' || !kindsFit(lib.kind, f.kind)) continue;
      const tail = commonTail(lib.path, f.path);
      if (tail > best) {
        best = tail;
        hits = [j];
      } else if (tail === best && tail > 0) hits.push(j);
    }
    const roots = new Set(hits.map((h) => uf.find(h)));
    if (best > 0 && roots.size === 1) {
      uf.union(i, hits[0]!);
      strongest(i, 'path');
      continue;
    }
    // 4. No path in common: the root folders of the same media kind, when they
    //    all sit on one disk.
    if (lib.kind && lib.kind !== 'other') {
      const same = known.filter(({ f }) => f.use === 'media' && f.kind === lib.kind).map(({ i: j }) => j);
      const sameRoots = new Set(same.map((j) => uf.find(j)));
      if (same.length > 0 && sameRoots.size === 1) {
        uf.union(i, same[0]!);
        strongest(i, 'kind');
      }
    }
  }

  // 5. Whatever is left joins the other folders of the same service.
  const byInstance = new Map<string, number>();
  for (let i = 0; i < folders.length; i++) {
    const f = folders[i]!;
    const root = uf.find(i);
    const alone = folders.every((g, j) => j === i || uf.find(j) !== root);
    if (!alone) continue;
    const key = `${f.instanceId}:${f.use}`;
    const prev = byInstance.get(key);
    if (prev === undefined) byInstance.set(key, i);
    else uf.union(prev, i);
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < folders.length; i++) {
    const r = uf.find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  }
  return [...groups.values()].map((idx) => ({
    members: idx.map((i) => folders[i]!),
    match: idx.map((i) => match[i]!),
  }));
}

// ----------------------------------------------------------------- graph

export function deriveStackGraph(instances: TopologyInput[]): StackGraph {
  const nodes = new Map<string, MapNode>();
  const edges = new Map<string, MapEdge>();
  const active = instances.filter((i) => i.enabled);

  for (const i of instances) {
    nodes.set(i.id, {
      id: i.id,
      type: 'instance',
      layer: layerOf(i.category, i.adapter),
      name: i.name,
      adapter: i.adapter,
      instanceId: i.id,
    });
  }

  const addEdge = (e: Omit<MapEdge, 'id' | 'labels'> & { label: string }) => {
    const id = `${e.from}>${e.to}:${e.kind}`;
    const prev = edges.get(id);
    if (prev) {
      if (e.label && !prev.labels.includes(e.label)) prev.labels.push(e.label);
      prev.enabled ||= e.enabled;
      if (e.confident && !prev.confident) Object.assign(prev, { confident: true, match: e.match });
      if (e.indexerIds) prev.indexerIds = [...new Set([...(prev.indexerIds ?? []), ...e.indexerIds])];
      prev.is4k ||= e.is4k;
      return;
    }
    const { label, ...rest } = e;
    edges.set(id, { id, labels: label ? [label] : [], ...rest });
  };

  for (const reporter of active) {
    for (const link of reporter.topology?.links ?? []) {
      // Disabled instances still count as targets: the service is there, Wardarr just does not poll it.
      const hit = matchLink(link, instances, reporter.id);
      let to: string;
      if (hit) {
        to = hit.instance.id;
      } else {
        // Not connected to Wardarr: show a ghost, shared by every service that points there.
        if (!link.enabled) continue;
        const addr = parseAddress(link.url);
        const product = link.products[0] ?? null;
        to = `ghost:${product ?? slug(link.implementation)}:${addr ? `${addr.host}:${addr.port}` : slug(link.name)}`;
        if (!nodes.has(to))
          nodes.set(to, {
            id: to,
            type: 'ghost',
            layer: KIND_LAYER[link.kind],
            name: link.name || link.implementation,
            adapter: product,
            implementation: link.implementation,
            address: addr ? `${addr.host}:${addr.port}` : null,
          });
      }
      addEdge({
        from: reporter.id,
        to,
        kind: link.kind,
        label: link.name,
        enabled: link.enabled,
        match: hit?.match ?? 'self',
        confident: hit ? hit.confident : true,
        ...(link.indexerIds ? { indexerIds: link.indexerIds } : {}),
        ...(link.is4k ? { is4k: true } : {}),
      });
    }
  }

  // Storage: folders of all services, clustered into disks.
  const adapterOf = new Map(active.map((i) => [i.id, i.adapter]));
  const folders: FolderRef[] = active.flatMap((i) =>
    (i.topology?.folders ?? []).map((f) => ({ ...f, instanceId: i.id, adapter: adapterOf.get(i.id)! })),
  );
  const clusters = clusterFolders(folders)
    .map((c) => ({ ...c, key: c.members.map((m) => normPath(m.path)).sort()[0]! }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const storageOf = new Map<string, Set<string>>();
  clusters.forEach((c, n) => {
    const id = `storage:${n + 1}`;
    const spaced =
      c.members.find((m) => m.totalBytes !== null) ?? c.members.find((m) => m.freeBytes !== null);
    const mount = c.members.find((m) => m.mount && m.mount !== '/')?.mount ?? null;
    const writers = c.members.filter((m) => m.use !== 'library').map((m) => m.path);
    nodes.set(id, {
      id,
      type: 'storage',
      layer: 3,
      name: mount ?? commonPrefix(writers.length ? writers : c.members.map((m) => m.path)) ?? '',
      adapter: null,
      storage: {
        freeBytes: spaced?.freeBytes ?? null,
        totalBytes: spaced?.totalBytes ?? null,
        mount,
        members: c.members.map((m, k) => ({
          instanceId: m.instanceId,
          path: m.path,
          use: m.use,
          ...(m.name ? { name: m.name } : {}),
          ...(m.kind ? { kind: m.kind } : {}),
          ...(m.accessible === false ? { accessible: false } : {}),
          match: c.match[k]!,
        })),
      },
    });
    const byInstance = new Map<string, { use: StorageFolder['use']; match: MatchKind[] }>();
    c.members.forEach((m, k) => {
      const prev = byInstance.get(m.instanceId);
      if (prev) prev.match.push(c.match[k]!);
      else byInstance.set(m.instanceId, { use: m.use, match: [c.match[k]!] });
    });
    for (const [instanceId, { use, match }] of byInstance) {
      storageOf.set(instanceId, (storageOf.get(instanceId) ?? new Set()).add(id));
      const how: MatchKind = match.includes('self')
        ? 'self'
        : match.includes('space')
          ? 'space'
          : match.includes('path')
            ? 'path'
            : 'kind';
      const reading = use === 'library';
      addEdge({
        from: reading ? id : instanceId,
        to: reading ? instanceId : id,
        kind: 'storage',
        label: '',
        enabled: true,
        match: how,
        confident: how !== 'kind',
        use,
      });
    }
  });

  // A library refresh link adds nothing to draw when both ends share a disk.
  for (const e of edges.values()) {
    if (e.kind !== 'libraryUpdate') continue;
    const a = storageOf.get(e.from);
    const b = storageOf.get(e.to);
    if (a && b && [...a].some((s) => b.has(s))) e.redundant = true;
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
