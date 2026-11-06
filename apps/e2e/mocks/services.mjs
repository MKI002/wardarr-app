// Invented *arr services for end-to-end tests. One HTTP server, one path
// prefix per service. All names, keys and titles are made up.
//
//   GET  /__control/state         current scenario
//   POST /__control/fix?what=...  fixes a problem (indexer, update, queue)
//   POST /__control/reset         restores the initial scenario
//   POST /__control/stage2        turns on the Queue Cleaner and Hunting scenario
//   GET  /__control/calls         changing calls the services received
import http from 'node:http';
import { INDEXER_APPS, INDEXER_STATS, createStage3 } from './stage3.mjs';

export const API_KEY = '00000000000000000000000000000001';
const PORT = Number(process.env.MOCK_PORT ?? 19000);
const HOST = process.env.MOCK_HOST ?? '127.0.0.1';

const initial = () => ({ indexerBroken: true, updateAvailable: true, queueFailed: true, stage2: false });
let state = initial();
/** POST and DELETE calls, so tests can check that a dry run changed nothing. */
let calls = [];
const stage3 = createStage3({
  apiKey: API_KEY,
  base: `http://${HOST}:${PORT}`,
  record: (c) => calls.push(c),
});

const FILM = (id, title, year, hasFile) => ({
  id,
  title,
  year,
  hasFile,
  monitored: true,
  isAvailable: true,
  tags: [],
  qualityProfileId: 1,
  digitalRelease: `${year}-03-01T00:00:00Z`,
});
const FILMS = [
  FILM(31, 'Example Film', 2021, false),
  FILM(32, 'Second Example', 2022, false),
  FILM(33, 'Third Example', 2023, false),
  FILM(34, 'Fourth Example', 2024, false),
];

const stage2Queue = () =>
  state.stage2
    ? [
        {
          id: 21,
          title: 'Example.Film.2021.2160p',
          status: 'completed',
          trackedDownloadStatus: 'warning',
          trackedDownloadState: 'failed',
          downloadId: 'E2EFAIL1',
          movieId: 31,
          movie: FILMS[0],
          size: 100,
          sizeleft: 0,
          protocol: 'torrent',
          downloadClient: 'Example Client',
          statusMessages: [{ title: 'Example.Film.2021.2160p', messages: ['Download failed'] }],
        },
        {
          id: 22,
          title: 'Second.Example.2022.2160p',
          status: 'completed',
          trackedDownloadStatus: 'warning',
          trackedDownloadState: 'importBlocked',
          downloadId: 'E2EIMPORT1',
          movieId: 32,
          movie: FILMS[1],
          size: 100,
          sizeleft: 0,
          protocol: 'torrent',
          downloadClient: 'Example Client',
          statusMessages: [
            {
              title: 'Second.Example.2022.2160p',
              messages: ['Found matching movie via grab history, but release was matched to movie by ID'],
            },
          ],
        },
      ]
    : [];

const indexerHealth = (app) =>
  state.indexerBroken
    ? [
        {
          source: 'IndexerLongTermStatusCheck',
          type: 'warning',
          message: 'Indexers unavailable due to failures for more than 6 hours: ExampleIndexer (Prowlarr)',
          wikiUrl: `https://wiki.servarr.com/${app}/system#indexers-are-unavailable-due-to-failures`,
        },
      ]
    : [];

const SERVICES = {
  sonarr: {
    api: '/api/v3',
    appName: 'Sonarr',
    version: '4.0.15.2941',
    health: () => indexerHealth('sonarr'),
    queue: () => [],
  },
  'sonarr-4k': {
    api: '/api/v3',
    appName: 'Sonarr',
    version: '4.0.15.2941',
    health: () => [],
    queue: () => [],
  },
  radarr: {
    api: '/api/v3',
    appName: 'Radarr',
    version: '5.26.2.10099',
    health: () => indexerHealth('radarr'),
    queue: () => [],
  },
  'radarr-4k': {
    api: '/api/v3',
    appName: 'Radarr',
    version: '5.26.2.10099',
    health: () => indexerHealth('radarr'),
    queue: stage2Queue,
    stage2: true,
  },
  lidarr: {
    api: '/api/v1',
    appName: 'Lidarr',
    version: '2.13.3.4711',
    health: () =>
      state.updateAvailable
        ? [
            {
              source: 'UpdateCheck',
              type: 'warning',
              message: 'New update is available: v9.9.9',
              wikiUrl: 'https://wiki.servarr.com/lidarr/system#new-update-is-available',
            },
          ]
        : [],
    queue: () =>
      state.queueFailed
        ? [
            {
              id: 1,
              title: 'Example Artist-Album One',
              status: 'completed',
              trackedDownloadStatus: 'warning',
              trackedDownloadState: 'failed',
              downloadId: 'DL0001',
              albumId: 11,
              size: 1,
              sizeleft: 0,
              protocol: 'torrent',
              downloadClient: 'Example Client',
              statusMessages: [{ title: 'Example Artist-Album One', messages: ['Download failed'] }],
            },
            {
              id: 2,
              title: 'Example Artist-Album Two',
              status: 'completed',
              trackedDownloadStatus: 'warning',
              trackedDownloadState: 'failed',
              downloadId: 'DL0002',
              albumId: 12,
              size: 1,
              sizeleft: 0,
              protocol: 'torrent',
              downloadClient: 'Example Client',
              statusMessages: [{ title: 'Example Artist-Album Two', messages: ['Download failed'] }],
            },
            {
              id: 3,
              title: 'Example Artist-Album Three',
              status: 'completed',
              trackedDownloadStatus: 'warning',
              trackedDownloadState: 'failed',
              downloadId: 'DL0003',
              albumId: 13,
              size: 1,
              sizeleft: 0,
              protocol: 'usenet',
              downloadClient: 'Example Client',
              statusMessages: [{ title: 'Example Artist-Album Three', messages: ['Download failed'] }],
            },
          ]
        : [],
  },
};

const EXAMPLE_INDEXER = { id: 7, name: 'ExampleIndexer', enable: true, protocol: 'torrent', priority: 25 };

function prowlarr(path, res, method) {
  if (path === '/api/v1/indexer/7') return json(res, EXAMPLE_INDEXER);
  if (path === '/api/v1/indexer/test' && method === 'POST')
    return state.indexerBroken
      ? json(res, [{ errorMessage: 'Unable to connect to indexer' }], 400)
      : json(res, {});
  if (path === '/api/v1/system/status') return json(res, { version: '2.0.5.5160', appName: 'Prowlarr' });
  if (path === '/api/v1/health') return json(res, []);
  if (path === '/api/v1/indexer') return json(res, [EXAMPLE_INDEXER]);
  if (path === '/api/v1/indexerstats') return json(res, INDEXER_STATS);
  if (path === '/api/v1/applications') return json(res, INDEXER_APPS);
  if (path === '/api/v1/indexerstatus')
    return json(
      res,
      state.indexerBroken
        ? [{ indexerId: 7, disabledTill: '2099-01-01T00:00:00Z', mostRecentFailure: '2026-01-01T00:00:00Z' }]
        : [],
    );
  return notFound(res);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

/** The parts of a Radarr API the Queue Cleaner and Hunting use. */
async function stage2(prefix, p, url, req, res) {
  if (req.method === 'POST' || req.method === 'DELETE') {
    calls.push({ service: prefix, method: req.method, path: p, body: await readBody(req) });
  }
  if (p === '/tag') return json(res, [{ id: 1, label: 'wardarr-keep' }]);
  if (p === '/qualityprofile') return json(res, [{ id: 1, name: 'Ultra HD' }]);
  if (p === '/movie') return json(res, [...(state.stage2 ? FILMS : []), ...stage3.radarrMovies[prefix]]);
  if (p === '/wanted/cutoff') return json(res, { page: 1, pageSize: 250, totalRecords: 0, records: [] });
  if (p === '/history/since') return json(res, []);
  if (p === '/manualimport' && req.method === 'GET') {
    if (url.searchParams.get('downloadId') !== 'E2EIMPORT1') return json(res, []);
    return json(res, [
      {
        path: '/downloads/Second.Example.2022.2160p/second.example.2022.mkv',
        name: 'second.example.2022',
        folderName: 'Second.Example.2022.2160p',
        movie: { id: 32, title: 'Second Example', year: 2022 },
        quality: { quality: { id: 19, name: 'Bluray-2160p' } },
        languages: [{ id: 1, name: 'English' }],
        rejections: [],
      },
    ]);
  }
  if (p === '/command' && req.method === 'POST')
    return json(res, { id: 1, name: 'Command', status: 'queued' }, 201);
  if (p.startsWith('/queue/') && req.method === 'DELETE') return json(res, {});
  return notFound(res);
}

function json(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function notFound(res) {
  res.writeHead(404);
  res.end();
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock.invalid');
    const [, prefix = '', ...rest] = url.pathname.split('/');
    const path = `/${rest.join('/')}`;
    if (prefix === '__control') {
      if (path === '/state') return json(res, state);
      if (path === '/calls') return json(res, calls);
      if (path === '/reset' && req.method === 'POST') {
        state = initial();
        calls = [];
        return json(res, state);
      }
      if (path === '/stage2' && req.method === 'POST') {
        state.stage2 = true;
        state.indexerBroken = false;
        return json(res, state);
      }
      if (path === '/fix' && req.method === 'POST') {
        const what = url.searchParams.get('what');
        if (what === 'indexer') state.indexerBroken = false;
        if (what === 'update') state.updateAvailable = false;
        if (what === 'queue') state.queueFailed = false;
        return json(res, state);
      }
      return notFound(res);
    }
    if (prefix === 'jellyfin') return stage3.jellyfin(path, url, req, res, json);
    if (req.headers['x-api-key'] !== API_KEY) {
      res.writeHead(401);
      return res.end();
    }
    if (prefix === 'prowlarr') return prowlarr(path, res, req.method);
    if (prefix === 'seerr') {
      const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : null;
      return stage3.seerr(path, url, req, res, json, body);
    }
    const svc = SERVICES[prefix];
    if (!svc || !path.startsWith(svc.api)) return notFound(res);
    const p = path.slice(svc.api.length);
    if (p === '/system/status') return json(res, { version: svc.version, appName: svc.appName });
    if (p === '/health') return json(res, svc.health());
    if (p === '/queue') {
      const records = svc.queue();
      return json(res, { page: 1, pageSize: 250, totalRecords: records.length, records });
    }
    if (p === '/config/host') return json(res, { port: 8989, urlBase: '', apiKey: API_KEY });
    if (p === '/movie' && req.method === 'POST') {
      if (stage3.radarr(prefix, p, req, res, json, await readBody(req))) return;
    }
    if (svc.stage2) return stage2(prefix, p, url, req, res);
    if (p === '/movie') return json(res, stage3.radarrMovies[prefix] ?? []);
    return notFound(res);
  })
  .listen(PORT, HOST);
