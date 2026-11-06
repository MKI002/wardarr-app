// Layered layout for the stack map. Columns follow the flow of media:
// requests and indexers, *arr apps, download clients, storage, media servers.
// Edges that skip a column get waypoints, so they run through gaps instead
// of behind nodes. Pure functions, so the layout is stable between refreshes.
import type { MapEdge, MapNode } from './types';

export type Orientation = 'horizontal' | 'vertical';

export interface PlacedNode {
  node: MapNode;
  x: number;
  y: number;
  /** Column index after empty layers are dropped. */
  column: number;
}

export interface PlacedEdge {
  edge: MapEdge;
  d: string;
  mid: { x: number; y: number };
}

export interface MapLayout {
  width: number;
  height: number;
  orientation: Orientation;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
}

/** Radius of a node circle and the room its two label lines take below it. */
export const NODE_R = 26;
export const LABEL_H = 38;

const SPACING = {
  horizontal: { main: 184, real: 120, dummy: 30, marginMain: 76, marginCross: 46 },
  vertical: { main: 140, real: 108, dummy: 10, marginMain: 46, marginCross: 54 },
} as const;

const PRODUCT_ORDER = [
  'seerr',
  'prowlarr',
  'bazarr',
  'sonarr',
  'radarr',
  'lidarr',
  'readarr',
  'whisparr',
  'qbittorrent',
  'transmission',
  'deluge',
  'sabnzbd',
  'nzbget',
  'plex',
  'jellyfin',
  'emby',
];

interface Item {
  id: string;
  dummy: boolean;
  /** Ids of items in the previous and next column this item is joined to. */
  prev: string[];
  next: string[];
}

function rank(n: MapNode): [number, number, string] {
  const p = PRODUCT_ORDER.indexOf(n.adapter ?? '');
  return [n.type === 'ghost' ? 1 : 0, p === -1 ? PRODUCT_ORDER.length : p, n.name.toLowerCase()];
}

function compareNodes(a: MapNode, b: MapNode): number {
  const [a1, a2, a3] = rank(a);
  const [b1, b2, b3] = rank(b);
  return a1 - b1 || a2 - b2 || a3.localeCompare(b3) || a.id.localeCompare(b.id);
}

/** How many nodes fit side by side in a row of the vertical layout. */
export function nodesPerRow(width: number, minScale: number): number {
  const S = SPACING.vertical;
  return Math.max(1, Math.floor((width / minScale - 2 * S.marginCross) / S.real));
}

/**
 * Lays the map out. `maxPerColumn` wraps a crowded layer into several
 * columns (rows when vertical), so a phone screen never needs to scroll sideways.
 */
export function computeLayout(
  nodes: MapNode[],
  edges: MapEdge[],
  orientation: Orientation,
  maxPerColumn = Infinity,
): MapLayout {
  const S = SPACING[orientation];
  const layers = [...new Set(nodes.map((n) => n.layer))].sort((a, b) => a - b);
  const sorted = [...nodes].sort(compareNodes);
  const columnOf = new Map<string, number>();
  let next = 0;
  for (const layer of layers) {
    const inLayer = sorted.filter((n) => n.layer === layer);
    const parts = Math.max(1, Math.ceil(inLayer.length / maxPerColumn));
    inLayer.forEach((n, i) => columnOf.set(n.id, next + Math.floor(i / Math.ceil(inLayer.length / parts))));
    next += parts;
  }
  const columns: Item[][] = Array.from({ length: next }, () => []);
  const items = new Map<string, Item>();

  for (const n of sorted) {
    const item: Item = { id: n.id, dummy: false, prev: [], next: [] };
    items.set(n.id, item);
    columns[columnOf.get(n.id)!]!.push(item);
  }

  // Chains of items per edge, from the lower column to the higher one.
  const chains = new Map<string, string[]>();
  for (const e of edges) {
    if (e.redundant) continue;
    const cf = columnOf.get(e.from);
    const ct = columnOf.get(e.to);
    if (cf === undefined || ct === undefined) continue;
    const [a, b, ca, cb] = cf <= ct ? [e.from, e.to, cf, ct] : [e.to, e.from, ct, cf];
    const chain = [a];
    for (let c = ca + 1; c < cb; c++) {
      const id = `~${e.id}~${c}`;
      const item: Item = { id, dummy: true, prev: [], next: [] };
      items.set(id, item);
      columns[c]!.push(item);
      chain.push(id);
    }
    chain.push(b);
    if (ca !== cb)
      for (let k = 0; k < chain.length - 1; k++) {
        items.get(chain[k]!)!.next.push(chain[k + 1]!);
        items.get(chain[k + 1]!)!.prev.push(chain[k]!);
      }
    chains.set(e.id, cf <= ct ? chain : [...chain].reverse());
  }

  // Barycenter ordering: a few sweeps down and up reduce crossings.
  const index = new Map<string, number>();
  const reindex = () => columns.forEach((col) => col.forEach((it, i) => index.set(it.id, i)));
  reindex();
  const sweep = (col: Item[], side: 'prev' | 'next') => {
    const bc = new Map(
      col.map((it, i) => {
        const ns = it[side];
        return [it.id, ns.length ? ns.reduce((s, n) => s + index.get(n)!, 0) / ns.length : i];
      }),
    );
    col.sort((a, b) => bc.get(a.id)! - bc.get(b.id)!);
  };
  for (let iter = 0; iter < 6; iter++) {
    for (let c = 1; c < columns.length; c++) {
      sweep(columns[c]!, 'prev');
      reindex();
    }
    for (let c = columns.length - 2; c >= 0; c--) {
      sweep(columns[c]!, 'next');
      reindex();
    }
  }

  // Cross-axis positions: each column is centred on the tallest one.
  const size = (it: Item) => (it.dummy ? S.dummy : S.real);
  const lengths = columns.map((col) => col.reduce((s, it) => s + size(it), 0));
  const longest = Math.max(S.real, ...lengths);
  const pos = new Map<string, { main: number; cross: number }>();
  columns.forEach((col, c) => {
    let at = (longest - lengths[c]!) / 2;
    for (const it of col) {
      pos.set(it.id, { main: S.marginMain + c * S.main, cross: S.marginCross + at + size(it) / 2 });
      at += size(it);
    }
  });

  const horizontal = orientation === 'horizontal';
  const xy = (p: { main: number; cross: number }) =>
    horizontal ? { x: p.main, y: p.cross } : { x: p.cross, y: p.main };

  const placed: PlacedNode[] = nodes.map((node) => {
    const p = xy(pos.get(node.id)!);
    return { node, column: columnOf.get(node.id)!, ...p };
  });

  // Edges leave a node on the side facing the next column. Vertically the
  // labels sit below the circle, so edges leave below the labels.
  const outOffset = horizontal ? NODE_R + 4 : NODE_R + LABEL_H;
  const inOffset = NODE_R + 4;
  const placedEdges: PlacedEdge[] = [];
  for (const e of edges) {
    if (e.redundant) continue;
    const chain = chains.get(e.id);
    if (!chain) continue;
    const pts = chain.map((id) => ({ ...pos.get(id)!, real: !items.get(id)!.dummy }));
    const forward = pts[pts.length - 1]!.main >= pts[0]!.main;
    if (pts.length === 2 && pts[0]!.main === pts[1]!.main) {
      // Same column: a small arc beside the column.
      const [a, b] = pts as [(typeof pts)[0], (typeof pts)[0]];
      const bulge = S.main * 0.35;
      const p0 = xy({ main: a.main + inOffset, cross: a.cross });
      const p1 = xy({ main: b.main + inOffset, cross: b.cross });
      const c0 = xy({ main: a.main + bulge, cross: a.cross });
      const c1 = xy({ main: b.main + bulge, cross: b.cross });
      placedEdges.push({
        edge: e,
        d: `M${p0.x},${p0.y} C${c0.x},${c0.y} ${c1.x},${c1.y} ${p1.x},${p1.y}`,
        mid: xy({ main: a.main + bulge * 0.75, cross: (a.cross + b.cross) / 2 }),
      });
      continue;
    }
    const dir = forward ? 1 : -1;
    const anchors = pts.map((p, k) => {
      if (!p.real) return { main: p.main, cross: p.cross };
      if (k === 0) return { main: p.main + dir * (forward ? outOffset : inOffset), cross: p.cross };
      return { main: p.main - dir * (forward ? inOffset : outOffset), cross: p.cross };
    });
    let d = '';
    const start = xy(anchors[0]!);
    d += `M${start.x},${start.y}`;
    let mid = start;
    const middleSeg = Math.floor((anchors.length - 1) / 2);
    for (let k = 0; k < anchors.length - 1; k++) {
      const a = anchors[k]!;
      const b = anchors[k + 1]!;
      const half = (b.main - a.main) / 2;
      const c0 = xy({ main: a.main + half, cross: a.cross });
      const c1 = xy({ main: b.main - half, cross: b.cross });
      const p = xy(b);
      d += ` C${c0.x},${c0.y} ${c1.x},${c1.y} ${p.x},${p.y}`;
      if (k === middleSeg) {
        // Point at t = 0.5 of this cubic segment.
        const pa = xy(a);
        mid = {
          x: 0.125 * pa.x + 0.375 * c0.x + 0.375 * c1.x + 0.125 * p.x,
          y: 0.125 * pa.y + 0.375 * c0.y + 0.375 * c1.y + 0.125 * p.y,
        };
      }
    }
    placedEdges.push({ edge: e, d, mid });
  }

  const mainLen = S.marginMain * 2 + Math.max(0, columns.length - 1) * S.main;
  const crossLen = S.marginCross * 2 + longest + (horizontal ? LABEL_H - 20 : 0);
  return {
    width: horizontal ? mainLen : crossLen,
    height: horizontal ? crossLen : mainLen + LABEL_H,
    orientation,
    nodes: placed,
    edges: placedEdges,
  };
}
