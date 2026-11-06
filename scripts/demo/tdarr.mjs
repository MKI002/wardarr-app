// A mock Tdarr server (API v2) with invented nodes, totals, libraries and
// failures. The demo and the end-to-end tests use it; nothing here comes
// from a real installation.

/** Tdarr reports sizes in gigabytes and times in milliseconds. */
function worker(id, type, file, percentage, fps, eta, startedMinutesAgo, sizeGb, estGb, now) {
  return {
    _id: id,
    workerType: type,
    idle: false,
    file,
    percentage,
    fps,
    ETA: eta,
    status: type.startsWith('healthcheck') ? 'Health check' : 'Processing',
    originalfileSizeInGbytes: sizeGb,
    estSize: estGb,
    job: { start: now - startedMinutesAgo * 60_000 },
  };
}

/**
 * Builds the mock. `now` fixes the clock, so job start times stay stable
 * between captures.
 */
export function createTdarr({ now = Date.now(), version = '2.27.01', apiKey = '' } = {}) {
  const movies = '/data/media/movies';
  const tv = '/data/media/tv';
  const nodes = {
    'node-main': {
      _id: 'node-main',
      nodeName: 'Server node',
      nodePaused: false,
      workerLimits: { transcodecpu: 1, transcodegpu: 2, healthcheckcpu: 2, healthcheckgpu: 0 },
      resStats: { os: { cpuPerc: '71.4', memUsedGB: '9.6', memTotalGB: '31.2' } },
      workers: {
        'w-gpu-1': worker(
          'w-gpu-1',
          'transcodegpu',
          `${movies}/Nosferatu (1922)/Nosferatu (1922) Remux-1080p.mkv`,
          63.4,
          142,
          '0:06:51',
          14,
          18.7,
          6.2,
          now,
        ),
        'w-gpu-2': worker(
          'w-gpu-2',
          'transcodegpu',
          `${tv}/Kestrel Station/Season 01/Kestrel Station S01E02.mkv`,
          21.9,
          131,
          '0:11:30',
          4,
          3.4,
          1.3,
          now,
        ),
        'w-hc-1': worker(
          'w-hc-1',
          'healthcheckcpu',
          `${tv}/Lanternfall/Season 01/Lanternfall S01E04.mkv`,
          41,
          0,
          '0:00:38',
          1,
          1.7,
          0,
          now,
        ),
        'w-idle': { _id: 'w-idle', workerType: 'healthcheckcpu', idle: true },
      },
    },
    'node-attic': {
      _id: 'node-attic',
      nodeName: 'Attic mini PC',
      nodePaused: false,
      workerLimits: { transcodecpu: 2, transcodegpu: 0, healthcheckcpu: 1, healthcheckgpu: 0 },
      resStats: { os: { cpuPerc: '88.2', memUsedGB: '6.9', memTotalGB: '8' } },
      workers: {
        'w-cpu-1': worker(
          'w-cpu-1',
          'transcodecpu',
          `${movies}/The Great Train Robbery (1903)/The Great Train Robbery (1903) Bluray-1080p.mkv`,
          18.2,
          27,
          '0:24:10',
          9,
          2.1,
          0.8,
          now,
        ),
      },
    },
    'node-desk': {
      _id: 'node-desk',
      nodeName: 'Desktop',
      nodePaused: true,
      workerLimits: { transcodecpu: 0, transcodegpu: 1, healthcheckcpu: 1, healthcheckgpu: 0 },
      resStats: { os: { cpuPerc: '6.0', memUsedGB: '11.3', memTotalGB: '32' } },
      workers: {},
    },
  };
  const statistics = {
    totalFileCount: 1452,
    totalTranscodeCount: 611,
    totalHealthCheckCount: 1398,
    sizeDiff: 734.6,
    table0Count: 0,
    table1Count: 88,
    table2Count: 1342,
    table3Count: 7,
    table4Count: 21,
    table5Count: 1371,
    table6Count: 3,
  };
  const libraries = [
    { _id: 'lib-films', name: 'Films', folder: movies },
    { _id: 'lib-films-4k', name: 'Films 4K', folder: '/data/media/movies-4k' },
    { _id: 'lib-series', name: 'Series', folder: tv },
  ];
  const pies = {
    'lib-films': { totalFiles: 61, totalTranscodeCount: 48, sizeDiff: 412.3, totalHealthCheckCount: 60 },
    'lib-films-4k': { totalFiles: 6, totalTranscodeCount: 0, sizeDiff: 0, totalHealthCheckCount: 6 },
    'lib-series': {
      totalFiles: 1385,
      totalTranscodeCount: 563,
      sizeDiff: 322.3,
      totalHealthCheckCount: 1332,
    },
  };
  const file = (path, sizeMb, status, minutesAgo, kind) => ({
    _id: path,
    file: path,
    file_size: sizeMb,
    ...(kind === 'transcode'
      ? { TranscodeDecisionMaker: status, lastTranscodeDate: now - minutesAgo * 60_000 }
      : { HealthCheck: status, lastHealthCheckDate: now - minutesAgo * 60_000 }),
  });
  const failed = {
    table3: [
      file(
        `${movies}/Intolerance (1916)/Intolerance (1916) Bluray-1080p.mkv`,
        14_200,
        'Transcode error',
        52,
        'transcode',
      ),
      file(
        `${tv}/The Salt Archive/Season 01/The Salt Archive S01E03.mkv`,
        1_480,
        'Transcode error',
        190,
        'transcode',
      ),
      file(
        `${tv}/The Salt Archive/Season 01/The Salt Archive S01E04.mkv`,
        1_510,
        'Transcode error',
        191,
        'transcode',
      ),
      file(
        `${tv}/Lanternfall/Season 01/Lanternfall S01E01.mkv`,
        1_700,
        'Transcode cancelled',
        900,
        'transcode',
      ),
      file(
        `${movies}/Nanook of the North (1922)/Nanook of the North (1922) DVD.mkv`,
        3_900,
        'Transcode error',
        1_800,
        'transcode',
      ),
      file(
        `${tv}/Kestrel Station/Season 01/Kestrel Station S01E01.mkv`,
        3_300,
        'Transcode error',
        2_950,
        'transcode',
      ),
      file(
        `${tv}/Lanternfall/Season 01/Lanternfall S01E06.mkv`,
        1_650,
        'Transcode error',
        4_100,
        'transcode',
      ),
    ],
    table6: [
      file(`${tv}/The Salt Archive/Season 01/The Salt Archive S01E05.mkv`, 1_390, 'Error', 75, 'healthCheck'),
      file(
        `${movies}/A Trip to the Moon (1902)/A Trip to the Moon (1902) WEBDL-720p.mp4`,
        410,
        'Error',
        1_300,
        'healthCheck',
      ),
      file(`${tv}/Lanternfall/Season 01/Lanternfall S01E02.mkv`, 1_720, 'Error', 3_600, 'healthCheck'),
    ],
  };

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const body = (req) =>
    new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => (data += c));
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });

  /** Handles a request below the mock's prefix, for example `/api/v2/status`. */
  return async function handle(path, req, res) {
    if (apiKey && req.headers['x-api-key'] !== apiKey) return send(res, 401, { message: 'Unauthorized' });
    if (path === '/api/v2/status')
      return send(res, 200, { status: 'good', isProduction: true, os: 'linux', version, uptime: 512_000 });
    if (path === '/api/v2/get-nodes') return send(res, 200, nodes);
    if (req.method !== 'POST') return send(res, 404, {});
    const data = (await body(req)).data ?? {};
    if (path === '/api/v2/cruddb') {
      if (data.collection === 'StatisticsJSONDB' && data.docID === 'statistics')
        return send(res, 200, statistics);
      if (data.collection === 'LibrarySettingsJSONDB' && data.mode === 'getAll')
        return send(res, 200, libraries);
      return send(res, 400, {});
    }
    if (path === '/api/v2/stats/get-pies') {
      const pie = pies[data.libraryId];
      return pie ? send(res, 200, { pieStats: pie }) : send(res, 404, {});
    }
    if (path === '/api/v2/client/status-tables') {
      const rows = failed[data.opts?.table] ?? [];
      const start = Number(data.start ?? 0);
      const size = Number(data.pageSize ?? 10);
      return send(res, 200, { array: rows.slice(start, start + size), totalCount: rows.length });
    }
    return send(res, 404, {});
  };
}
