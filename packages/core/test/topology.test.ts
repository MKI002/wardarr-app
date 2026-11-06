// Stack map derivation. Every service, host and path is invented.
import { describe, expect, it } from 'vitest';
import type { ServiceTopology } from '../src/adapter/types.js';
import { deriveStackGraph, matchLink, type TopologyInput } from '../src/topology/derive.js';

const GB = 1024 ** 3;

function inst(
  id: string,
  adapter: string,
  category: TopologyInput['category'],
  topology: Partial<ServiceTopology> | null = null,
  extra: Partial<TopologyInput> = {},
): TopologyInput {
  return {
    id,
    name: id,
    adapter,
    category,
    baseUrl: `http://wardarr-test.invalid/${id}`,
    enabled: true,
    topology: topology ? { links: [], folders: [], ...topology } : null,
    ...extra,
  };
}

const edge = (g: ReturnType<typeof deriveStackGraph>, from: string, to: string) =>
  g.edges.find((e) => e.from === from && e.to === to);

describe('matchLink', () => {
  const radarr = inst('Radarr', 'radarr', 'arr', null, { baseUrl: 'http://192.0.2.5:7878' });
  const radarr4k = inst('Radarr 4K', 'radarr', 'arr', null, { baseUrl: 'http://192.0.2.5:7879' });

  it('prefers the address', () => {
    const hit = matchLink(
      { products: ['radarr'], name: 'Whatever', url: 'http://192.0.2.5:7879' },
      [radarr, radarr4k],
      'x',
    );
    expect(hit?.instance.id).toBe('Radarr 4K');
    expect(hit?.match).toBe('address');
    expect(hit?.confident).toBe(true);
  });

  it('falls back to the name when hosts differ, for example container names', () => {
    const hit = matchLink(
      { products: ['radarr'], name: 'Radarr 4K', url: 'http://radarr4k:7878' },
      [radarr, radarr4k],
      'x',
    );
    expect(hit?.instance.id).toBe('Radarr 4K');
    expect(hit?.match).toBe('name');
  });

  it('takes the only instance of a product, but not confidently', () => {
    const hit = matchLink({ products: ['radarr'], name: 'Movies', url: 'http://movies:7878' }, [radarr], 'x');
    expect(hit?.instance.id).toBe('Radarr');
    expect(hit?.confident).toBe(false);
  });

  it('gives up when two instances fit equally well', () => {
    expect(
      matchLink({ products: ['radarr'], name: 'Films', url: 'http://films:7878' }, [radarr, radarr4k], 'x'),
    ).toBeNull();
  });

  it('prefers the closer partial name', () => {
    const hit = matchLink(
      { products: ['radarr'], name: 'radarr-main', url: null },
      [inst('Radarr', 'radarr', 'arr'), inst('Radarr UHD Archive', 'radarr', 'arr')],
      'x',
    );
    expect(hit?.instance.id).toBe('Radarr');
  });
});

describe('deriveStackGraph', () => {
  it('works with no instances and with one', () => {
    expect(deriveStackGraph([])).toEqual({ nodes: [], edges: [] });
    const g = deriveStackGraph([inst('Sonarr', 'sonarr', 'arr', null)]);
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0]).toMatchObject({ type: 'instance', layer: 1 });
    expect(g.edges).toEqual([]);
  });

  it('links Prowlarr, Seerr and Bazarr to the *arr apps and the *arr apps to their clients', () => {
    const g = deriveStackGraph([
      inst('Prowlarr', 'prowlarr', 'indexer', {
        links: [
          {
            kind: 'indexers',
            products: ['sonarr'],
            implementation: 'Sonarr',
            name: 'Sonarr',
            url: 'http://sonarr:8989',
            enabled: true,
            indexerIds: [1, 2],
          },
        ],
      }),
      inst('Seerr', 'seerr', 'requests', {
        links: [
          {
            kind: 'requests',
            products: ['sonarr'],
            implementation: 'sonarr',
            name: 'Sonarr',
            url: null,
            enabled: true,
          },
          {
            kind: 'mediaServer',
            products: ['jellyfin'],
            implementation: 'jellyfin',
            name: 'Home',
            url: null,
            enabled: true,
          },
        ],
      }),
      inst('Bazarr', 'bazarr', 'arr', {
        links: [
          {
            kind: 'subtitles',
            products: ['sonarr'],
            implementation: 'sonarr',
            name: 'Sonarr',
            url: null,
            enabled: true,
          },
        ],
      }),
      inst('Sonarr', 'sonarr', 'arr', {
        links: [
          {
            kind: 'downloads',
            products: ['qbittorrent'],
            implementation: 'QBittorrent',
            name: 'qBittorrent',
            url: 'http://qbit:8080',
            enabled: true,
          },
          {
            kind: 'downloads',
            products: [],
            implementation: 'Aria2',
            name: 'Aria',
            url: 'http://aria:6800',
            enabled: true,
          },
          {
            kind: 'downloads',
            products: ['sabnzbd'],
            implementation: 'Sabnzbd',
            name: 'Old',
            url: 'http://old:8080',
            enabled: false,
          },
        ],
      }),
      inst('qBittorrent', 'qbittorrent', 'downloader', null),
      inst('Jellyfin', 'jellyfin', 'mediaServer', null),
    ]);
    expect(edge(g, 'Prowlarr', 'Sonarr')).toMatchObject({ kind: 'indexers', indexerIds: [1, 2] });
    expect(edge(g, 'Seerr', 'Sonarr')?.kind).toBe('requests');
    expect(edge(g, 'Seerr', 'Jellyfin')?.kind).toBe('mediaServer');
    expect(edge(g, 'Bazarr', 'Sonarr')?.kind).toBe('subtitles');
    expect(edge(g, 'Sonarr', 'qBittorrent')?.kind).toBe('downloads');
    // An unknown client becomes a ghost in the download column; a disabled one is left out.
    const ghost = g.nodes.find((n) => n.type === 'ghost');
    expect(ghost).toMatchObject({ name: 'Aria', implementation: 'Aria2', layer: 2, address: 'aria:6800' });
    expect(g.nodes.filter((n) => n.type === 'ghost')).toHaveLength(1);
    expect(g.nodes.find((n) => n.id === 'Bazarr')?.layer).toBe(0);
  });

  it('shares one ghost between services that point at the same address', () => {
    const client = {
      kind: 'downloads' as const,
      products: ['qbittorrent'],
      implementation: 'QBittorrent',
      name: 'qBittorrent',
      url: 'http://qbit:8080',
      enabled: true,
    };
    const g = deriveStackGraph([
      inst('Sonarr', 'sonarr', 'arr', { links: [client] }),
      inst('Radarr', 'radarr', 'arr', { links: [{ ...client, name: 'Torrents' }] }),
    ]);
    const ghosts = g.nodes.filter((n) => n.type === 'ghost');
    expect(ghosts).toHaveLength(1);
    expect(g.edges.filter((e) => e.to === ghosts[0]!.id)).toHaveLength(2);
  });

  it('puts folders on one disk into one storage node, matched by disk size and free space', () => {
    const disk = { freeBytes: 812 * GB, totalBytes: 3700 * GB };
    const g = deriveStackGraph([
      inst('Sonarr', 'sonarr', 'arr', {
        folders: [{ path: '/data/media/tv', use: 'media', kind: 'show', mount: '/data', ...disk }],
      }),
      inst('Radarr', 'radarr', 'arr', {
        folders: [
          {
            path: '/data/media/movies',
            use: 'media',
            kind: 'movie',
            mount: '/data',
            ...disk,
            freeBytes: 811 * GB,
          },
        ],
      }),
      // qBittorrent reports only the free space.
      inst('qBittorrent', 'qbittorrent', 'downloader', {
        folders: [{ path: '/data/torrents', use: 'downloads', freeBytes: 812 * GB, totalBytes: null }],
      }),
      // The media server mounts the same folders under other paths.
      inst('Jellyfin', 'jellyfin', 'mediaServer', {
        folders: [
          {
            path: '/media/tv',
            use: 'library',
            kind: 'show',
            name: 'Shows',
            freeBytes: null,
            totalBytes: null,
          },
          { path: '/films', use: 'library', kind: 'movie', name: 'Films', freeBytes: null, totalBytes: null },
        ],
      }),
    ]);
    const storage = g.nodes.filter((n) => n.type === 'storage');
    expect(storage).toHaveLength(1);
    const s = storage[0]!;
    expect(s.name).toBe('/data');
    expect(s.storage?.totalBytes).toBe(3700 * GB);
    expect(edge(g, 'Sonarr', s.id)).toMatchObject({ kind: 'storage', use: 'media' });
    expect(edge(g, 'qBittorrent', s.id)?.match).toBe('space');
    // Jellyfin reads from it: /media/tv by path, /films only by media kind.
    expect(edge(g, s.id, 'Jellyfin')).toMatchObject({ use: 'library', match: 'path', confident: true });
    const films = s.storage?.members.find((m) => m.path === '/films');
    expect(films?.match).toBe('kind');
  });

  it('keeps separate disks apart', () => {
    const g = deriveStackGraph([
      inst('Sonarr', 'sonarr', 'arr', {
        folders: [{ path: '/tv', use: 'media', kind: 'show', freeBytes: 100 * GB, totalBytes: 2000 * GB }],
      }),
      inst('Radarr', 'radarr', 'arr', {
        folders: [
          { path: '/movies', use: 'media', kind: 'movie', freeBytes: 900 * GB, totalBytes: 8000 * GB },
        ],
      }),
      inst('Plex', 'plex', 'mediaServer', {
        folders: [
          { path: '/library/tv', use: 'library', kind: 'show', freeBytes: null, totalBytes: null },
          { path: '/library/movies', use: 'library', kind: 'movie', freeBytes: null, totalBytes: null },
        ],
      }),
    ]);
    const storage = g.nodes.filter((n) => n.type === 'storage');
    expect(storage).toHaveLength(2);
    for (const s of storage) expect(edge(g, s.id, 'Plex')).toBeDefined();
  });

  it('marks a library refresh link as redundant when both ends share a disk', () => {
    const disk = { freeBytes: 50 * GB, totalBytes: 500 * GB };
    const g = deriveStackGraph([
      inst('Radarr', 'radarr', 'arr', {
        links: [
          {
            kind: 'libraryUpdate',
            products: ['jellyfin', 'emby'],
            implementation: 'MediaBrowser',
            name: 'Jellyfin',
            url: null,
            enabled: true,
          },
        ],
        folders: [{ path: '/movies', use: 'media', kind: 'movie', ...disk }],
      }),
      inst('Jellyfin', 'jellyfin', 'mediaServer', {
        folders: [{ path: '/movies', use: 'library', kind: 'movie', freeBytes: null, totalBytes: null }],
      }),
    ]);
    expect(edge(g, 'Radarr', 'Jellyfin')).toMatchObject({ kind: 'libraryUpdate', redundant: true });
  });

  it('reads no links from disabled instances but still points at them', () => {
    const g = deriveStackGraph([
      inst('Prowlarr', 'prowlarr', 'indexer', {
        links: [
          {
            kind: 'indexers',
            products: ['radarr'],
            implementation: 'Radarr',
            name: 'Radarr',
            url: null,
            enabled: true,
          },
        ],
      }),
      inst(
        'Radarr',
        'radarr',
        'arr',
        {
          links: [
            {
              kind: 'downloads',
              products: ['sabnzbd'],
              implementation: 'Sabnzbd',
              name: 'SAB',
              url: null,
              enabled: true,
            },
          ],
        },
        { enabled: false },
      ),
    ]);
    expect(g.nodes.some((n) => n.name === 'SAB')).toBe(false);
    expect(edge(g, 'Prowlarr', 'Radarr')).toBeDefined();
    expect(g.nodes.some((n) => n.type === 'ghost')).toBe(false);
  });
});
