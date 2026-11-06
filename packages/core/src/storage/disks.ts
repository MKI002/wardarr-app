// Disks of the *arr apps. Every app reports the mounts it can see; several
// apps often see the same physical disk under different paths (`/tv` in
// Sonarr, `/movies` in Radarr). Wardarr folds those into one disk, so free
// space is counted once and a full disk is one issue, not one per app.
import { hash } from '../issues/rules/helpers.js';
import type { InstanceRef } from '../issues/types.js';

/** What one app reports about its storage. */
export interface DiskReport {
  /** Mounts the app can see (`/diskspace`). */
  disks: Array<{ path: string; label?: string | null; freeBytes: number; totalBytes: number }>;
  /** Root folders the app stores media in (`/rootfolder`). */
  rootFolders: Array<{
    path: string;
    freeBytes: number | null;
    totalBytes: number | null;
    accessible: boolean;
  }>;
}

export interface DiskMember {
  instance: InstanceRef;
  /** Mount path as this app sees it. */
  path: string;
  /** Root folders of this app on the mount. */
  rootFolders: string[];
}

export interface Disk {
  /** Stable id, kept across restarts and app changes. */
  key: string;
  label: string;
  totalBytes: number;
  freeBytes: number;
  /** At least one app keeps a root folder on this disk. */
  media: boolean;
  members: DiskMember[];
}

/** A disk Wardarr saw before, to keep its key when members change. */
export interface KnownDisk {
  key: string;
  totalBytes: number;
  members: string[];
}

const GiB = 1024 ** 3;
/** Mounts below this size are system files (`/etc/hosts`), not storage. */
const MIN_BYTES = GiB;
/** Kernel and container plumbing Docker shows as mounts. */
const PSEUDO = /^\/(proc|sys|dev|run|etc|boot\/efi)(\/|$)/;

export function memberId(m: { instance: { id: string }; path: string }): string {
  return `${m.instance.id}:${m.path}`;
}

function normalizePath(p: string): string {
  const trimmed = p.trim();
  if (trimmed === '/' || /^[a-z]:\\?$/i.test(trimmed)) return trimmed;
  return trimmed.replace(/[\\/]+$/, '');
}

/** True when `folder` lies on the mount `mount`. */
function onMount(mount: string, folder: string): boolean {
  if (mount === '/') return folder.startsWith('/');
  const m = mount.toLowerCase();
  const f = folder.toLowerCase();
  return f === m || f.startsWith(`${m}/`) || f.startsWith(`${m}\\`) || (m.endsWith('\\') && f.startsWith(m));
}

interface Mount {
  instance: InstanceRef;
  path: string;
  label: string | null;
  freeBytes: number;
  totalBytes: number;
  rootFolders: string[];
}

/** The mounts of one app, with its root folders assigned to the deepest mount. */
function mountsOf(instance: InstanceRef, report: DiskReport): Mount[] {
  const mounts: Mount[] = [];
  const seen = new Set<string>();
  for (const d of report.disks) {
    const path = normalizePath(d.path);
    if (!path || seen.has(path)) continue;
    if (!(d.totalBytes >= MIN_BYTES) || !(d.freeBytes >= 0) || PSEUDO.test(path)) continue;
    seen.add(path);
    mounts.push({
      instance,
      path,
      label: d.label?.trim() || null,
      freeBytes: Math.min(d.freeBytes, d.totalBytes),
      totalBytes: d.totalBytes,
      rootFolders: [],
    });
  }
  const byDepth = [...mounts].sort((a, b) => b.path.length - a.path.length);
  for (const rf of report.rootFolders) {
    const folder = normalizePath(rf.path);
    const mount = byDepth.find((m) => onMount(m.path, folder));
    if (mount) {
      mount.rootFolders.push(folder);
      continue;
    }
    // Some setups hide the mount from /diskspace; the root folder still
    // knows its free space and, in newer versions, its size.
    if (rf.totalBytes && rf.totalBytes >= MIN_BYTES && rf.freeBytes !== null && rf.freeBytes >= 0) {
      const m: Mount = {
        instance,
        path: folder,
        label: null,
        freeBytes: Math.min(rf.freeBytes, rf.totalBytes),
        totalBytes: rf.totalBytes,
        rootFolders: [folder],
      };
      mounts.push(m);
      byDepth.unshift(m);
    }
  }
  return mounts;
}

/** Two mounts are the same disk when size matches exactly and free space is close. */
function sameDisk(a: Mount, b: Mount): boolean {
  if (a.totalBytes !== b.totalBytes) return false;
  const tolerance = Math.max(GiB, a.totalBytes * 0.002);
  return Math.abs(a.freeBytes - b.freeBytes) <= tolerance;
}

function pickLabel(mounts: Mount[]): string {
  // The path most apps use, the shortest one on a tie.
  const counts = new Map<string, number>();
  for (const m of mounts) counts.set(m.path, (counts.get(m.path) ?? 0) + (m.rootFolders.length ? 2 : 1));
  return [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]),
  )[0]![0];
}

/**
 * Folds the mounts of all apps into disks. `known` keeps the keys of disks
 * seen before, so history stays attached when an app is added or removed.
 */
export function groupDisks(
  reports: Array<{ instance: InstanceRef; report: DiskReport }>,
  known: KnownDisk[] = [],
): Disk[] {
  const mounts = reports.flatMap((r) => mountsOf(r.instance, r.report));
  // Union-find over mounts that look like the same disk.
  const parent = mounts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < mounts.length; i++)
    for (let j = i + 1; j < mounts.length; j++)
      if (sameDisk(mounts[i]!, mounts[j]!)) parent[find(j)] = find(i);
  const clusters = new Map<number, Mount[]>();
  mounts.forEach((m, i) => {
    const root = find(i);
    clusters.set(root, [...(clusters.get(root) ?? []), m]);
  });

  const claimed = new Set<string>();
  const disks: Disk[] = [];
  const ordered = [...clusters.values()]
    .map((ms) => ms.sort((a, b) => memberId(a).localeCompare(memberId(b))))
    .sort((a, b) => memberId(a[0]!).localeCompare(memberId(b[0]!)));
  for (const ms of ordered) {
    const ids = ms.map(memberId);
    // Reuse the key of the known disk that shares most members.
    let best: KnownDisk | undefined;
    let bestOverlap = 0;
    for (const k of known) {
      if (claimed.has(k.key)) continue;
      const overlap = k.members.filter((id) => ids.includes(id)).length;
      if (overlap > bestOverlap) {
        best = k;
        bestOverlap = overlap;
      }
    }
    let key = best?.key;
    if (!key) {
      const base = `d${hash(`${ms[0]!.totalBytes}|${ids[0]}`)}`;
      key = base;
      for (let n = 2; claimed.has(key) || known.some((k) => k.key === key); n++) key = `${base}-${n}`;
    }
    claimed.add(key);
    // Free space as the latest reader saw it; they differ by seconds at most.
    const freeBytes = Math.min(...ms.map((m) => m.freeBytes));
    disks.push({
      key,
      label: pickLabel(ms),
      totalBytes: ms[0]!.totalBytes,
      freeBytes,
      media: ms.some((m) => m.rootFolders.length > 0),
      members: ms.map((m) => ({ instance: m.instance, path: m.path, rootFolders: m.rootFolders })),
    });
  }
  return disks.sort(
    (a, b) => Number(b.media) - Number(a.media) || a.freeBytes / a.totalBytes - b.freeBytes / b.totalBytes,
  );
}
