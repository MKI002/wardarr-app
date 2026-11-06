import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THRESHOLDS,
  RULE_CATALOG,
  diskLevel,
  forecastDisk,
  groupDisks,
  type DiskReport,
  type Signal,
  type UsageSample,
} from '../src/index.js';
import { groupSignals } from '../src/index.js';
import { t } from './render.js';

const GiB = 1024 ** 3;
const TiB = 1024 * GiB;
const sonarr = { id: 's1', name: 'Sonarr', adapter: 'sonarr' };
const radarr = { id: 'r1', name: 'Radarr', adapter: 'radarr' };
const lidarr = { id: 'l1', name: 'Lidarr', adapter: 'lidarr' };

function report(disks: Array<[string, number, number]>, rootFolders: string[] = []): DiskReport {
  return {
    disks: disks.map(([path, free, total]) => ({ path, freeBytes: free, totalBytes: total })),
    rootFolders: rootFolders.map((path) => ({ path, freeBytes: null, totalBytes: null, accessible: true })),
  };
}

describe('groupDisks', () => {
  it('folds the same disk seen by several apps under different paths into one', () => {
    const disks = groupDisks([
      { instance: sonarr, report: report([['/tv', 2 * TiB, 8 * TiB]], ['/tv/shows']) },
      // Radarr read a moment later; a few hundred MB were written in between.
      { instance: radarr, report: report([['/movies', 2 * TiB - 300 * 1024 ** 2, 8 * TiB]], ['/movies']) },
      { instance: lidarr, report: report([['/music', 500 * GiB, 2 * TiB]], ['/music']) },
    ]);
    expect(disks).toHaveLength(2);
    const big = disks.find((d) => d.totalBytes === 8 * TiB)!;
    expect(big.members.map((m) => m.instance.id).sort()).toEqual(['r1', 's1']);
    expect(big.freeBytes).toBe(2 * TiB - 300 * 1024 ** 2);
    expect(big.media).toBe(true);
  });

  it('keeps two disks of the same size apart when their free space differs', () => {
    const disks = groupDisks([
      { instance: sonarr, report: report([['/tv', 3 * TiB, 8 * TiB]]) },
      { instance: radarr, report: report([['/movies', 1 * TiB, 8 * TiB]]) },
    ]);
    expect(disks).toHaveLength(2);
    expect(new Set(disks.map((d) => d.key)).size).toBe(2);
  });

  it('drops system mounts and tiny files Docker shows as mounts', () => {
    const disks = groupDisks([
      {
        instance: sonarr,
        report: report([
          ['/etc/hosts', 40 * GiB, 60 * GiB],
          ['/dev/shm', 1024 ** 2, 64 * 1024 ** 2],
          ['/config', 40 * GiB, 60 * GiB],
          ['/proc/acpi', 0, 0],
        ]),
      },
    ]);
    expect(disks.map((d) => d.label)).toEqual(['/config']);
  });

  it('puts a root folder on its deepest mount', () => {
    const [media] = groupDisks([
      {
        instance: sonarr,
        report: report(
          [
            ['/', 30 * GiB, 60 * GiB],
            ['/data', 1 * TiB, 4 * TiB],
          ],
          ['/data/tv'],
        ),
      },
    ]);
    expect(media!.label).toBe('/data');
    expect(media!.members[0]!.rootFolders).toEqual(['/data/tv']);
  });

  it('uses a root folder with a size when its mount is not listed', () => {
    const disks = groupDisks([
      {
        instance: lidarr,
        report: {
          disks: [],
          rootFolders: [{ path: '/music', freeBytes: 100 * GiB, totalBytes: 1 * TiB, accessible: true }],
        },
      },
    ]);
    expect(disks).toHaveLength(1);
    expect(disks[0]!.media).toBe(true);
  });

  it('keeps the key of a known disk when an app joins', () => {
    const first = groupDisks([{ instance: sonarr, report: report([['/tv', 2 * TiB, 8 * TiB]]) }]);
    const known = first.map((d) => ({
      key: d.key,
      totalBytes: d.totalBytes,
      members: d.members.map((m) => `${m.instance.id}:${m.path}`),
    }));
    const second = groupDisks(
      [
        { instance: radarr, report: report([['/movies', 2 * TiB, 8 * TiB]]) },
        { instance: sonarr, report: report([['/tv', 2 * TiB, 8 * TiB]]) },
      ],
      known,
    );
    expect(second).toHaveLength(1);
    expect(second[0]!.key).toBe(first[0]!.key);
  });
});

const NOW = new Date('2026-06-30T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function history(days: number, used: (d: number) => number): UsageSample[] {
  return Array.from({ length: days }, (_, i) => ({ at: day(days - 1 - i), usedBytes: used(i) }));
}

describe('forecastDisk', () => {
  it('waits for a few days of history', () => {
    const f = forecastDisk(
      history(2, (i) => i * GiB),
      { freeBytes: TiB, totalBytes: 2 * TiB },
      NOW,
    );
    expect(f.status).toBe('collecting');
  });

  it('projects a steady growth from today’s free space', () => {
    // 20 GiB a day, 400 GiB free: 20 days.
    const f = forecastDisk(
      history(30, (i) => 1000 * GiB + i * 20 * GiB),
      { freeBytes: 400 * GiB, totalBytes: 2 * TiB },
      NOW,
    );
    expect(f.status).toBe('filling');
    expect(f.bytesPerDay).toBe(20 * GiB);
    expect(f.daysLeft).toBeCloseTo(20, 0);
    expect(Date.parse(f.fullAt!)).toBeGreaterThan(NOW.getTime());
  });

  it('is not fooled by one big cleanup', () => {
    // Grows 10 GiB a day, then 500 GiB are deleted on day 20.
    const f = forecastDisk(
      history(30, (i) => 1000 * GiB + i * 10 * GiB - (i >= 20 ? 500 * GiB : 0)),
      { freeBytes: 600 * GiB, totalBytes: 2 * TiB },
      NOW,
    );
    expect(f.status).toBe('filling');
    expect(f.bytesPerDay! / GiB).toBeGreaterThan(8);
    expect(f.bytesPerDay! / GiB).toBeLessThan(12);
  });

  it('calls a disk that does not grow stable', () => {
    const f = forecastDisk(
      history(30, () => 500 * GiB),
      { freeBytes: TiB, totalBytes: 2 * TiB },
      NOW,
    );
    expect(f.status).toBe('stable');
    expect(f.daysLeft).toBeNull();
  });

  it('gives a range: early when growth is fast, late or never when it is slow', () => {
    const f = forecastDisk(
      history(30, (i) => 1000 * GiB + i * 15 * GiB + (i % 3 === 0 ? 40 * GiB : 0)),
      { freeBytes: 500 * GiB, totalBytes: 2 * TiB },
      NOW,
    );
    expect(Date.parse(f.earliestAt!)).toBeLessThanOrEqual(Date.parse(f.fullAt!));
    if (f.latestAt) expect(Date.parse(f.latestAt)).toBeGreaterThanOrEqual(Date.parse(f.fullAt!));
  });

  it('reports a full disk at once', () => {
    expect(forecastDisk([], { freeBytes: 0, totalBytes: TiB }, NOW).status).toBe('full');
  });
});

describe('diskLevel', () => {
  const filling = (daysLeft: number) => ({
    ...forecastDisk([], { freeBytes: TiB, totalBytes: 2 * TiB }, NOW),
    status: 'filling' as const,
    daysLeft,
  });

  it('warns and escalates by days left and by free share', () => {
    const disk = { freeBytes: TiB, totalBytes: 2 * TiB };
    expect(diskLevel(disk, filling(90), DEFAULT_THRESHOLDS).level).toBe('ok');
    expect(diskLevel(disk, filling(25), DEFAULT_THRESHOLDS)).toEqual({
      level: 'warning',
      reason: 'forecast',
    });
    expect(diskLevel(disk, filling(5), DEFAULT_THRESHOLDS)).toEqual({
      level: 'critical',
      reason: 'forecast',
    });
    const low = { freeBytes: 0.03 * 2 * TiB, totalBytes: 2 * TiB };
    expect(diskLevel(low, filling(90), DEFAULT_THRESHOLDS)).toEqual({ level: 'warning', reason: 'lowSpace' });
  });
});

describe('disk-filling-up rule', () => {
  const signal = (data: Record<string, unknown>): Signal => ({
    origin: 'service',
    instance: sonarr,
    kind: 'storage',
    source: 'Storage.disk',
    channel: 'storage',
    level: 'warning',
    message: 'disk',
    data,
  });

  it('turns one disk into one issue with a readable forecast', () => {
    const [g] = groupSignals(
      [
        signal({
          disk: 'd1',
          label: '/data',
          level: 'warning',
          reason: 'forecast',
          freeBytes: 400 * GiB,
          totalBytes: 8 * TiB,
          percentFree: 4.9,
          daysLeft: 18.4,
          apps: 'Sonarr, Radarr',
        }),
      ],
      RULE_CATALOG,
    );
    expect(g!.fingerprint).toBe('disk-filling-up:d1');
    expect(g!.severity).toBe('warning');
    expect(t(g!.title)).toBe('Disk /data is filling up');
    expect(t(g!.affected)).toBe('Full in about 18 days · 400 GB free');
    expect(t(g!.explanation)).toContain('Sonarr, Radarr');
    expect(g!.actions.map((a) => a.href ?? a.kind)).toContain('/storage?disk=d1');
  });

  it('says how little is left when the disk is almost full', () => {
    const [g] = groupSignals(
      [
        signal({
          disk: 'd2',
          label: '/media',
          level: 'critical',
          reason: 'lowSpace',
          freeBytes: 1.5 * TiB * 0.01,
          totalBytes: 1.5 * TiB,
          percentFree: 1,
          daysLeft: 0,
          apps: 'Radarr',
        }),
      ],
      RULE_CATALOG,
    );
    expect(g!.severity).toBe('critical');
    expect(t(g!.title)).toBe('Disk /media is almost full');
    expect(t(g!.affected)).toBe('Only 15.4 GB free (1 %)');
  });
});
