// Invented *arr services for end-to-end tests. One HTTP server, one path
// prefix per service. All names, keys and titles are made up.
//
//   GET  /__control/state         current scenario
//   POST /__control/fix?what=...  fixes a problem (indexer, update, queue)
//   POST /__control/reset         restores the initial scenario
import http from 'node:http';

export const API_KEY = '00000000000000000000000000000001';
const PORT = Number(process.env.MOCK_PORT ?? 19000);
const HOST = process.env.MOCK_HOST ?? '127.0.0.1';

const initial = () => ({ indexerBroken: true, updateAvailable: true, queueFailed: true });
let state = initial();

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
    queue: () => [],
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
  if (path === '/api/v1/indexerstatus')
    return json(
      res,
      state.indexerBroken
        ? [{ indexerId: 7, disabledTill: '2099-01-01T00:00:00Z', mostRecentFailure: '2026-01-01T00:00:00Z' }]
        : [],
    );
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
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock.invalid');
    const [, prefix = '', ...rest] = url.pathname.split('/');
    const path = `/${rest.join('/')}`;
    if (prefix === '__control') {
      if (path === '/state') return json(res, state);
      if (path === '/reset' && req.method === 'POST') {
        state = initial();
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
    if (req.headers['x-api-key'] !== API_KEY) {
      res.writeHead(401);
      return res.end();
    }
    if (prefix === 'prowlarr') return prowlarr(path, res, req.method);
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
    return notFound(res);
  })
  .listen(PORT, HOST);
