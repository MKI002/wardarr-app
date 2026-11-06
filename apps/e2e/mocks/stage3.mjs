// Invented Seerr and Jellyfin for the stage 3 end-to-end tests. A request
// made in Seerr is sent on to the Radarr mock, as the real Seerr would.
// All titles, users and numbers are made up.

const TITLES = [
  { id: 9001, mediaType: 'movie', title: 'Example Voyage', releaseDate: '2025-04-11', voteAverage: 7.4 },
  { id: 9002, mediaType: 'movie', title: 'Example Harbor', releaseDate: '2024-09-20', voteAverage: 6.8 },
  { id: 9003, mediaType: 'tv', name: 'Example Chronicles', firstAirDate: '2023-02-02', voteAverage: 8.1 },
];

const SERVERS = {
  radarr: [
    {
      id: 0,
      name: 'Radarr',
      is4k: false,
      isDefault: true,
      activeProfileId: 1,
      activeDirectory: '/films',
      target: 'radarr',
    },
    {
      id: 1,
      name: 'Radarr 4K',
      is4k: true,
      isDefault: true,
      activeProfileId: 1,
      activeDirectory: '/films-uhd',
      target: 'radarr-4k',
    },
  ],
  sonarr: [
    {
      id: 0,
      name: 'Sonarr',
      is4k: false,
      isDefault: true,
      activeProfileId: 1,
      activeDirectory: '/series',
      target: 'sonarr',
    },
  ],
};

export function createStage3({ apiKey, base, record }) {
  /** Media state per TMDB id: status and status4k as Seerr numbers. */
  const media = new Map([
    [9002, { status: 5, status4k: 1 }],
    [9003, { status: 2, status4k: 1 }],
  ]);
  const requests = [];
  /** Films the Radarr mocks received, per mock prefix. */
  const radarrMovies = { radarr: [], 'radarr-4k': [] };

  const mediaInfo = (id) => {
    const m = media.get(id);
    return m ? { ...m, seasons: [] } : undefined;
  };
  const item = (t) => ({
    ...t,
    posterPath: null,
    overview: 'An invented title for tests.',
    mediaInfo: mediaInfo(t.id),
  });
  const page = (results) => ({
    page: 1,
    totalPages: 1,
    totalResults: results.length,
    results: results.map(item),
  });
  const asRequest = (r) => ({
    id: r.id,
    status: r.status,
    is4k: r.is4k,
    createdAt: r.createdAt,
    updatedAt: r.createdAt,
    serverId: r.serverId,
    profileId: 1,
    rootFolder: r.rootFolder,
    media: { mediaType: r.mediaType, tmdbId: r.tmdbId, ...(media.get(r.tmdbId) ?? {}) },
    requestedBy: { id: r.userId, displayName: r.userId === 1 ? 'Example Admin' : 'Example Viewer' },
    seasons: (r.seasons ?? []).map((n) => ({ seasonNumber: n })),
  });

  async function forward(r) {
    const server = SERVERS[r.mediaType === 'movie' ? 'radarr' : 'sonarr'].find((s) => s.id === r.serverId);
    if (!server || r.mediaType !== 'movie') return;
    const title = TITLES.find((t) => t.id === r.tmdbId);
    await fetch(`${base}/${server.target}/api/v3/movie`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({
        tmdbId: r.tmdbId,
        title: title?.title ?? '',
        qualityProfileId: 1,
        rootFolderPath: r.rootFolder,
        monitored: true,
        addOptions: { searchForMovie: true },
      }),
    });
    const key = r.is4k ? 'status4k' : 'status';
    media.set(r.tmdbId, { status: 1, status4k: 1, ...media.get(r.tmdbId), [key]: 3 });
  }

  async function seerr(path, url, req, res, json, body) {
    const p = path.replace(/^\/api\/v1/, '');
    const userId = Number(req.headers['x-api-user'] ?? 1);
    if (p === '/status') return json(res, { version: '2.7.3', updateAvailable: false });
    if (p === '/auth/me') return json(res, { id: 1 });
    if (p === '/discover/trending') return json(res, page(TITLES));
    if (p === '/discover/movies') return json(res, page(TITLES.filter((t) => t.mediaType === 'movie')));
    if (p === '/discover/tv') return json(res, page(TITLES.filter((t) => t.mediaType === 'tv')));
    if (p === '/search') {
      const q = (url.searchParams.get('query') ?? '').toLowerCase();
      return json(res, page(TITLES.filter((t) => (t.title ?? t.name).toLowerCase().includes(q))));
    }
    const detail = p.match(/^\/(movie|tv)\/(\d+)$/);
    if (detail) {
      const t = TITLES.find((x) => x.id === Number(detail[2]) && x.mediaType === detail[1]);
      if (!t) return json(res, {}, 404);
      return json(res, {
        ...item(t),
        externalIds: { tvdbId: t.mediaType === 'tv' ? 79003 : undefined },
        seasons:
          t.mediaType === 'tv'
            ? [1, 2].map((n) => ({ seasonNumber: n, name: `Season ${n}`, episodeCount: 6 }))
            : undefined,
      });
    }
    const service = p.match(/^\/service\/(radarr|sonarr)(?:\/(\d+))?$/);
    if (service) {
      const list = SERVERS[service[1]];
      if (service[2] === undefined)
        return json(
          res,
          list.map(({ target: _t, ...s }) => s),
        );
      const s = list.find((x) => x.id === Number(service[2]));
      return json(res, {
        server: s,
        profiles: [{ id: 1, name: s?.is4k ? 'Ultra HD' : 'HD-1080p' }],
        rootFolders: [{ id: 1, path: s?.activeDirectory }],
      });
    }
    if (p === '/user') {
      return json(res, {
        pageInfo: { results: 2 },
        results: [
          { id: 1, displayName: 'Example Admin', username: 'admin' },
          { id: 2, displayName: 'Example Viewer', jellyfinUsername: 'viewer' },
        ],
      });
    }
    if (p === '/request' && req.method === 'POST') {
      record({ service: 'seerr', method: 'POST', path: p, body, user: userId });
      const server = SERVERS[body.mediaType === 'movie' ? 'radarr' : 'sonarr'].find((s) =>
        body.serverId === undefined ? s.isDefault && s.is4k === !!body.is4k : s.id === body.serverId,
      );
      const r = {
        id: requests.length + 1,
        status: userId === 1 ? 2 : 1,
        mediaType: body.mediaType,
        tmdbId: body.mediaId,
        is4k: !!body.is4k,
        serverId: server?.id ?? 0,
        rootFolder: body.rootFolder ?? server?.activeDirectory,
        seasons: Array.isArray(body.seasons) ? body.seasons : [],
        userId,
        createdAt: new Date().toISOString(),
      };
      requests.unshift(r);
      const key = r.is4k ? 'status4k' : 'status';
      media.set(r.tmdbId, { status: 1, status4k: 1, ...media.get(r.tmdbId), [key]: 2 });
      // Seerr approves admin requests at once and sends them on.
      if (r.status === 2) await forward(r);
      return json(res, asRequest(r), 201);
    }
    if (p === '/request') {
      const filter = url.searchParams.get('filter') ?? 'all';
      const by = url.searchParams.get('requestedBy');
      const list = requests
        .filter(
          (r) =>
            filter === 'all' ||
            (filter === 'pending' ? r.status === 1 : filter === 'approved' ? r.status === 2 : true),
        )
        .filter((r) => !by || r.userId === Number(by));
      return json(res, { pageInfo: { results: list.length }, results: list.map(asRequest) });
    }
    const one = p.match(/^\/request\/(\d+)(?:\/(approve|decline|retry))?$/);
    if (one) {
      const r = requests.find((x) => x.id === Number(one[1]));
      if (!r) return json(res, {}, 404);
      if (one[2]) {
        record({ service: 'seerr', method: 'POST', path: p, body: null, user: userId });
        if (one[2] === 'approve') {
          r.status = 2;
          await forward(r);
        }
        if (one[2] === 'decline') r.status = 3;
      }
      return json(res, asRequest(r));
    }
    return json(res, {}, 404);
  }

  const LIBRARIES = [
    { Name: 'Films', CollectionType: 'movies', ItemId: 'lib-films' },
    { Name: 'Series', CollectionType: 'tvshows', ItemId: 'lib-series' },
  ];
  const stream = (size, height, codec) => ({
    MediaSources: [{ Size: size, MediaStreams: [{ Type: 'Video', Height: height, Codec: codec }] }],
  });
  const ITEMS = {
    'lib-films:Movie': [stream(8e9, 2160, 'hevc'), stream(4e9, 1080, 'h264'), stream(3e9, 1080, 'h264')],
    'lib-series:Series': [{}, {}],
    'lib-series:Episode': [
      stream(1e9, 1080, 'h264'),
      stream(1e9, 1080, 'h264'),
      stream(6e8, 720, 'h264'),
      stream(6e8, 720, 'h264'),
    ],
  };

  function jellyfin(path, url, req, res, json) {
    if (req.headers.authorization !== `MediaBrowser Token="${apiKey}"`) return json(res, {}, 401);
    if (path === '/System/Info') return json(res, { Version: '10.10.7', ProductName: 'Jellyfin Server' });
    if (path === '/Sessions') {
      return json(res, [
        {
          Id: 'session-1',
          UserName: 'Example Viewer',
          Client: 'Example Client',
          DeviceName: 'Example Device',
          PlayMethod: 'DirectPlay',
          PlayState: { PositionTicks: 12_000_000_000, IsPaused: false },
          NowPlayingItem: {
            Name: 'Example Harbor',
            Type: 'Movie',
            RunTimeTicks: 60_000_000_000,
            Height: 1080,
          },
        },
      ]);
    }
    if (path === '/Library/VirtualFolders') return json(res, LIBRARIES);
    if (path === '/Items') {
      const list =
        ITEMS[`${url.searchParams.get('ParentId')}:${url.searchParams.get('IncludeItemTypes')}`] ?? [];
      const start = Number(url.searchParams.get('StartIndex') ?? 0);
      const limit = Number(url.searchParams.get('Limit') ?? 100);
      return json(res, {
        TotalRecordCount: list.length,
        Items: limit === 0 ? [] : list.slice(start, start + limit),
      });
    }
    return json(res, {}, 404);
  }

  /** Radarr receiving films from Seerr. Returns true when it handled the call. */
  function radarr(prefix, p, req, res, json, body) {
    if (!(prefix in radarrMovies) || p !== '/movie') return false;
    if (req.method === 'POST') {
      record({ service: prefix, method: 'POST', path: p, body });
      radarrMovies[prefix].push({ id: 500 + radarrMovies[prefix].length, ...body, hasFile: false });
      json(res, radarrMovies[prefix].at(-1), 201);
      return true;
    }
    return false;
  }

  return { seerr, jellyfin, radarr, radarrMovies };
}

export const INDEXER_STATS = {
  indexers: [
    {
      indexerId: 7,
      indexerName: 'ExampleIndexer',
      numberOfQueries: 240,
      numberOfGrabs: 31,
      numberOfFailedQueries: 12,
      numberOfFailedGrabs: 1,
      averageResponseTime: 420,
    },
  ],
};

export const INDEXER_APPS = [
  { id: 1, name: 'Sonarr', implementation: 'Sonarr', syncLevel: 'fullSync', tags: [], fields: [] },
  { id: 2, name: 'Radarr', implementation: 'Radarr', syncLevel: 'fullSync', tags: [], fields: [] },
];
