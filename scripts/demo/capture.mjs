#!/usr/bin/env node
// Captures the demo data: starts the built Wardarr server against the demo
// mocks (services.mjs), sets it up like a real install and records every
// API answer the web UI asks for. The result is
// apps/web/src/demo/fixtures.json, which the demo build serves in place of a
// server.
//
// Usage (after `pnpm build`): node scripts/demo/capture.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexerStatusChanges } from '../../apps/e2e/mocks/indexers.mjs';
import { DEMO_DISKS } from './disks.mjs';
import { DEMO_KEY, FILMS, SERIES } from './titles.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const MOCK_PORT = 19300;
const PORT = 18585;
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(root, 'apps/web/src/demo/fixtures.json');

/** Hosts in the captured data are replaced with names a real install would use. */
const HOSTS = [
  [`${MOCK}/sonarr-4k`, 'http://sonarr-4k:8989'],
  [`${MOCK}/sonarr`, 'http://sonarr:8989'],
  [`${MOCK}/radarr-4k`, 'http://radarr-4k:7878'],
  [`${MOCK}/radarr`, 'http://radarr:7878'],
  [`${MOCK}/lidarr`, 'http://lidarr:8686'],
  [`${MOCK}/prowlarr`, 'http://prowlarr:9696'],
  [`${MOCK}/qbittorrent`, 'http://qbittorrent:8080'],
  [`${MOCK}/sabnzbd`, 'http://sabnzbd:8080'],
  [`${MOCK}/jellyfin`, 'http://jellyfin:8096'],
  [`${MOCK}/seerr`, 'http://seerr:5055'],
  [`${MOCK}/tdarr`, 'http://tdarr:8265'],
  [`${MOCK}/hook`, 'https://hooks.example.com'],
  [`${MOCK}/ntfy`, 'https://ntfy.example.com'],
  [MOCK, 'http://wardarr.example.com'],
];

const INSTANCES = [
  ['sonarr', 'Sonarr', 'sonarr', { apiKey: DEMO_KEY }],
  ['sonarr', 'Sonarr 4K', 'sonarr-4k', { apiKey: DEMO_KEY }],
  ['radarr', 'Radarr', 'radarr', { apiKey: DEMO_KEY }],
  ['radarr', 'Radarr 4K', 'radarr-4k', { apiKey: DEMO_KEY }],
  ['lidarr', 'Lidarr', 'lidarr', { apiKey: DEMO_KEY }],
  ['prowlarr', 'Prowlarr', 'prowlarr', { apiKey: DEMO_KEY }],
  ['qbittorrent', 'qBittorrent', 'qbittorrent', { username: 'demo', password: 'demo-password' }],
  ['sabnzbd', 'SABnzbd', 'sabnzbd', { apiKey: DEMO_KEY }],
  ['jellyfin', 'Jellyfin', 'jellyfin', { apiKey: DEMO_KEY }],
  ['seerr', 'Seerr', 'seerr', { apiKey: DEMO_KEY }],
  ['tdarr', 'Tdarr', 'tdarr', {}],
];
const ADMIN = { username: 'demo', password: 'demo-password-1' };
const USERS = [
  { username: 'mira', password: 'demo-password-2', displayName: 'Mira', role: 'user', seerrId: 2 },
  { username: 'jonas', password: 'demo-password-3', displayName: 'Jonas', role: 'user', seerrId: 3 },
];

const children = [];
const stop = () => children.forEach((c) => c.kill('SIGTERM'));
process.on('exit', stop);

function start(args, env = {}) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  children.push(child);
  return child;
}

async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${url} did not come up`);
}

let cookie = '';
let csrf = '';
async function call(method, p, body) {
  const headers = { accept: 'application/json', cookie };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET')
    Object.assign(headers, csrf ? { 'x-csrf-token': csrf } : { 'x-wardarr-request': '1' });
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
}
async function must(method, p, body) {
  const r = await call(method, p, body);
  if (r.status >= 400) throw new Error(`${method} ${p}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Up and down changes of the invented indexers over the last 30 days, written
 * straight into the database: Wardarr only records them while it runs.
 */
function seedIndexerStatus(instanceId) {
  const require = createRequire(path.join(root, 'apps/server/package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(path.join(dataDir, 'wardarr.db'));
  const insert = db.prepare(
    'INSERT INTO indexer_status_log (instance_id, indexer_id, indexer_name, at, failing) VALUES (?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    for (const c of indexerStatusChanges())
      insert.run(instanceId, c.indexerId, c.name, c.at, c.failing ? 1 : 0);
  })();
  db.close();
}

/**
 * Plays from the last months, written straight into the database: Wardarr
 * only records plays while it runs, and the demo should show some history.
 * Deterministic, so a new capture changes as little as possible.
 */
function seedStreamHistory(instanceId) {
  const require = createRequire(path.join(root, 'apps/server/package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(path.join(dataDir, 'wardarr.db'));
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const EPISODES = {
    Lanternfall: [
      'The Dark Coast',
      'Lamp Oil',
      'The Long Watch',
      'Fog Signal',
      'Keeper’s Log',
      'Spring Tide',
    ],
    'The Salt Archive': [
      'Index Cards',
      'Water Damage',
      'Dated Tomorrow',
      'The Ledger',
      'Low Shelves',
      'Return Address',
    ],
    'Kestrel Station': ['Pressure Drop', 'Isobars', 'Night Reading'],
  };
  const MINUTES = { nosferatu: 94, moon: 13, train: 12, intolerance: 163, nanook: 79 };
  const users = [
    ['Mira', 'Jellyfin Web', false, '1080p'],
    ['Jonas', 'Jellyfin Android', true, '720p'],
    ['Demo', 'Jellyfin Media Player', false, '4K'],
    ['Mira', 'Jellyfin for Android TV', false, '1080p'],
  ];
  const insert = db.prepare(
    `INSERT INTO stream_history (id, instance_id, session_id, user, title, subtitle, media_type, started_at,
       last_seen_at, ended_at, played_ms, duration_ms, progress, transcoding, resolution, client)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  const rows = [];
  for (let i = 0; i < 150; i++) {
    // Most plays in recent weeks, a few going back a year.
    const daysAgo = 1 + Math.floor(rand() * (rand() < 0.6 ? 40 : 360));
    // Evenings most, weekend afternoons too, rarely at night.
    const day = new Date(now - daysAgo * 86_400_000);
    const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
    const hours = weekend
      ? [11, 13, 14, 15, 16, 17, 19, 20, 20, 21, 21, 22]
      : [7, 12, 18, 19, 20, 20, 21, 21, 21, 22, 22, 23];
    day.setUTCHours(pick(hours), Math.floor(rand() * 60), 0, 0);
    const start = Math.min(day.getTime(), now - 3_600_000);
    const [user, client, transcoding, resolution] = pick(users);
    const isFilm = rand() < 0.45;
    let title;
    let subtitle = null;
    let minutes;
    if (isFilm) {
      const f = pick(FILMS.filter((x) => x.inLibrary || daysAgo < 20));
      title = f.title;
      minutes = MINUTES[f.key];
    } else {
      title = pick(Object.keys(EPISODES));
      const n = Math.floor(rand() * EPISODES[title].length);
      subtitle = `S01E${String(n + 1).padStart(2, '0')} · ${EPISODES[title][n]}`;
      minutes = 48 + Math.floor(rand() * 10);
    }
    const progress = rand() < 0.8 ? 100 : 20 + Math.floor(rand() * 70);
    const played = Math.round((minutes * 60_000 * progress) / 100);
    const end = new Date(start + played).toISOString();
    rows.push([
      instanceId,
      `demo-${i}`,
      user,
      title,
      subtitle,
      isFilm ? 'movie' : 'episode',
      new Date(start).toISOString(),
      end,
      end,
      played,
      minutes * 60_000,
      progress,
      transcoding ? 1 : 0,
      resolution,
      client,
    ]);
  }
  // History lists newest first by id: insert oldest first and keep the plays
  // Wardarr already saw (the sessions running now) on top.
  rows.sort((a, b) => a[6].localeCompare(b[6]));
  db.prepare('UPDATE stream_history SET id = id + 100000').run();
  rows.forEach((row, i) => insert.run(i + 1, ...row));
  db.close();
}

/**
 * A backup history like a few months of the default retention level: copies
 * of one real backup with earlier dates in their header and file name.
 */
function seedBackupHistory(dir) {
  const magic = 'WARDARR-BACKUP 1\n';
  const source = readdirSync(dir).find((f) => f.endsWith('.wbak'));
  const raw = readFileSync(path.join(dir, source));
  const end = raw.indexOf(0x0a, magic.length);
  const header = JSON.parse(raw.subarray(magic.length, end).toString('utf8'));
  const payload = raw.subarray(end + 1);
  const H = 3_600_000;
  const D = 24 * H;
  const ages = [
    [2 * H, 'scheduled'],
    [14 * H, 'scheduled'],
    ...[1, 2, 3, 4, 5, 6].map((d) => [d * D + 5 * H, 'scheduled']),
    ...[1, 2, 3, 4, 5, 6, 7].map((w) => [w * 7 * D + 3 * D, 'scheduled']),
    ...[2, 3, 4, 5].map((m) => [m * 30 * D + 9 * D, 'scheduled']),
    [11 * D + 2 * H, 'pre-migration'],
    [40 * D + 7 * H, 'manual'],
  ];
  const now = Date.now();
  ages.forEach(([age, kind], i) => {
    const at = new Date(now - age);
    const stamp = at
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z');
    const id = `wardarr-${stamp}-${kind}-${(0xd00000 + i).toString(16)}`;
    const line = `${magic}${JSON.stringify({ ...header, createdAt: at.toISOString(), kind })}\n`;
    writeFileSync(path.join(dir, `${id}.wbak`), Buffer.concat([Buffer.from(line), payload]));
  });
}

/**
 * Four months of disk history, written straight into the database like the
 * plays above: Wardarr only samples disks while it runs. The media disk had
 * a big cleanup six weeks ago; the 4K disk fills faster on weekends.
 */
function seedDiskHistory() {
  const require = createRequire(path.join(root, 'apps/server/package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(path.join(dataDir, 'wardarr.db'));
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const insert = db.prepare(
    'INSERT INTO disk_samples (disk_key, at, free_bytes, total_bytes) VALUES (?, ?, ?, ?)',
  );
  const now = Date.now();
  const GiB = 1024 ** 3;
  for (const disk of db.prepare('SELECT key, total_bytes, free_bytes FROM disks').all()) {
    const demo = Object.entries(DEMO_DISKS).find(([, d]) => d.totalBytes === disk.total_bytes);
    if (!demo) continue;
    const [name, d] = demo;
    const used = d.totalBytes - d.freeBytes;
    db.prepare('DELETE FROM disk_samples WHERE disk_key = ?').run(disk.key);
    for (let hours = 120 * 24; hours >= 3; hours -= 3) {
      const days = hours / 24;
      const weekday = new Date(now - hours * 3_600_000).getUTCDay();
      const weekend = weekday === 0 || weekday === 6;
      let u = used - d.perDay * days;
      if (name === 'data' && days > 42) u += 700 * GiB;
      // Upgrades land in bursts on weekends.
      if (name === 'uhd') u += (weekend ? 1.6 : -0.4) * d.perDay * rand();
      u += (rand() - 0.5) * d.perDay * 0.5;
      if (name === 'system') u = used + (rand() - 0.5) * 2 * GiB;
      const at = new Date(now - hours * 3_600_000).toISOString();
      const free = Math.max(0, Math.min(d.totalBytes, d.totalBytes - Math.round(u)));
      insert.run(disk.key, at, free, d.totalBytes);
    }
  }
  db.close();
}

/**
 * Tdarr: a month of daily counters, so the history and the space saved trend
 * have something to show, and a node that was connected until a few hours
 * ago, so the stack map and the issue center show an offline node.
 * Written straight into the database, like the stream history.
 */
function seedTranscodeHistory(instanceId) {
  const require = createRequire(path.join(root, 'apps/server/package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(path.join(dataDir, 'wardarr.db'));
  const today = db
    .prepare('SELECT * FROM transcode_daily WHERE instance_id = ? ORDER BY day DESC LIMIT 1')
    .get(instanceId);
  if (!today) throw new Error('Tdarr was not polled');
  const insert = db.prepare(
    `INSERT INTO transcode_daily (instance_id, day, transcodes, health_checks, saved_bytes,
       failed_transcodes, failed_health_checks, queued) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const row = { ...today };
  for (let i = 1; i < 30; i++) {
    // Walk back one day: undo that day's work.
    const weekend = new Date(Date.now() - (i - 1) * 86_400_000).getUTCDay() % 6 === 0;
    const transcodes = Math.round((weekend ? 30 : 14) + rand() * 12);
    row.transcodes -= transcodes;
    row.health_checks -= Math.round(transcodes * 1.4 + rand() * 6);
    row.saved_bytes -= Math.round(transcodes * (0.7 + rand() * 0.9) * 1024 ** 3);
    if (i === 1 || i === 3 || i === 9 || i === 16) row.failed_transcodes -= 1;
    if (i === 2) row.failed_health_checks -= 1;
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    insert.run(
      instanceId,
      day,
      row.transcodes,
      row.health_checks,
      row.saved_bytes,
      Math.max(0, row.failed_transcodes),
      Math.max(0, row.failed_health_checks),
      row.queued + Math.round(rand() * 40),
    );
  }
  const seen = new Date(Date.now() - 3 * 3_600_000).toISOString();
  const first = new Date(Date.now() - 40 * 86_400_000).toISOString();
  db.prepare(
    'INSERT INTO transcode_nodes (instance_id, node_id, name, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)',
  ).run(instanceId, 'node-garage', 'Garage NAS', first, seen);
  db.close();
}

const dataDir = mkdtempSync(path.join(tmpdir(), 'wardarr-demo-'));
try {
  start([path.join(here, 'services.mjs')], { DEMO_MOCK_PORT: String(MOCK_PORT) });
  start([path.join(root, 'apps/server/dist/main.js')], {
    WARDARR_DATA_DIR: dataDir,
    WARDARR_PORT: String(PORT),
    WARDARR_HOST: '127.0.0.1',
    WARDARR_LOG_LEVEL: 'warn',
    // The invented guide data, never the real TRaSH Guides.
    WARDARR_TRASH_DIR: path.join(root, 'testbed/trash-guides'),
  });
  await waitFor(`${MOCK}/__ready`);
  await waitFor(`${BASE}/healthz`);

  // ------------------------------------------------------------ set up
  csrf = (await must('POST', '/api/setup/admin', ADMIN)).csrfToken;
  const me = await must('GET', '/api/auth/me');
  await must('PATCH', `/api/users/${me.user.id}`, { displayName: 'Demo Admin' });
  const userIds = {};
  for (const u of USERS) {
    const { seerrId: _s, ...body } = u;
    const created = await must('POST', '/api/users', body);
    userIds[u.username] = created.id ?? created.user?.id;
  }
  const ids = {};
  for (const [adapter, name, mockPath, fields] of INSTANCES) {
    const created = await must('POST', '/api/instances', {
      adapter,
      name,
      baseUrl: `${MOCK}/${mockPath}`,
      fields,
    });
    ids[mockPath] = created.id;
  }
  for (const id of Object.values(ids)) await must('POST', `/api/instances/${id}/poll`);

  // Link Wardarr users to Seerr users, so requests show who asked.
  await call('PUT', `/api/requests/links/${me.user.id}`, { externalId: 1 });
  for (const u of USERS)
    await call('PUT', `/api/requests/links/${userIds[u.username]}`, { externalId: u.seerrId });

  // Notification channels.
  const events = { issueOpened: 'warning', issueResolved: true, requestPending: true };
  await call('POST', '/api/notifications', {
    name: 'Phone',
    kind: 'ntfy',
    language: 'en',
    events,
    config: { server: `${MOCK}/ntfy`, topic: 'wardarr-demo' },
  });
  await call('POST', '/api/notifications', {
    name: 'Home automation',
    kind: 'webhook',
    language: 'en',
    events: { ...events, issueOpened: 'critical', requestPending: false },
    config: { url: `${MOCK}/hook/wardarr` },
  });

  // TRaSH Guides: three templates, two synced instances, one with a change
  // made by hand, one waiting for its first sync.
  const trashTemplate = async (name, product, profiles, extra = {}) => {
    const catalog = await must('GET', `/api/trash/catalog/${product}`);
    const config = {
      profiles: profiles.map((n) => catalog.profiles.find((p) => p.name === n).suggested),
      qualitySize: catalog.qualitySizes[0]?.trashId ?? null,
      naming: Object.fromEntries(Object.keys(catalog.naming).map((k) => [k, 'default'])),
      rename: true,
      ...extra,
    };
    return (await must('POST', '/api/trash/templates', { name, product, config })).template.id;
  };
  const trashTemplates = {
    radarr: await trashTemplate('Movies HD', 'radarr', ['Example HD Bluray + WEB']),
    'radarr-4k': await trashTemplate('Movies 4K', 'radarr', ['Example UHD Bluray + WEB']),
    sonarr: await trashTemplate('Series', 'sonarr', ['Example WEB-1080p', '[German] Example WEB-1080p']),
  };
  for (const [key, templateId] of Object.entries(trashTemplates)) {
    await must('PUT', `/api/trash/instances/${ids[key]}/template`, { templateId });
  }
  for (const key of ['radarr', 'radarr-4k'])
    await must('POST', `/api/trash/instances/${ids[key]}/sync`, { confirm: true });
  await must('PUT', `/api/trash/instances/${ids.radarr}/guard`, { mode: 'auto', confirm: true });
  await fetch(`${MOCK}/__drift/radarr-4k`, { method: 'POST' });
  for (const key of Object.keys(trashTemplates)) await must('POST', `/api/trash/instances/${ids[key]}/check`);

  seedStreamHistory(ids.jellyfin);
  await must('POST', '/api/backups', {});
  seedBackupHistory(path.join(dataDir, 'backups'));
  await must('POST', '/api/storage/refresh');
  seedDiskHistory();
  await must('POST', '/api/storage/refresh');
  seedTranscodeHistory(ids.tdarr);
  await must('POST', `/api/library/${ids.jellyfin}/refresh`);

  // Read 30 days of invented indexer statistics and grab history.
  await must('POST', '/api/indexer-insights/collect');
  seedIndexerStatus(ids.prowlarr);
  // The priority watchdog in preview, with one run in its log.
  await must('PUT', '/api/indexer-insights/priorities', {
    enabled: true,
    mode: 'preview',
    includeApps: true,
  });
  await must('POST', '/api/indexer-insights/priorities/run');

  // Quality scores: hand-made custom formats next to the TRaSH ones, then
  // read every file once and wait until all reads are done.
  await fetch(`${MOCK}/__quality`, { method: 'POST' });
  await must('POST', '/api/quality/refresh', {});
  for (let i = 0; i < 60; i++) {
    const q = await must('GET', '/api/quality');
    if (!q.instances.some((x) => x.refreshing)) break;
    await sleep(500);
  }

  // Give the jobs (issue engine, library) a moment, then poll again.
  await sleep(3000);
  for (const id of Object.values(ids)) await call('POST', `/api/instances/${id}/poll`);
  for (const id of ['sonarr', 'radarr', 'radarr-4k', 'lidarr']) {
    await call('POST', `/api/cleaner/${ids[id]}/run`);
    await call('POST', `/api/hunting/${ids[id]}/run`);
  }
  await sleep(3000);

  // ----------------------------------------------------------- capture
  const fixtures = {};
  const get = async (p) => {
    const r = await call('GET', p);
    fixtures[p] = { status: r.status, body: r.data };
    if (r.status >= 400) console.warn(`  ${p} -> ${r.status}`);
    return r.data;
  };

  for (const p of [
    '/api/setup/status',
    '/api/auth/me',
    '/api/capabilities',
    '/api/overview',
    '/api/adapters',
    '/api/instances',
    '/api/queue',
    '/api/users',
    '/api/notifications',
    '/api/backups',
    '/api/indexers',
    '/api/quality',
    '/api/topology',
    '/api/tdarr',
    '/api/streams/history?limit=25',
    '/api/discover/instances',
    '/api/discover/options',
    '/api/requests/links',
  ])
    await get(p);

  // Every scored file once; the demo cuts states and pages out of it.
  const qualityFiles = [];
  for (let offset = 0; ; offset += 100) {
    const r = await call('GET', `/api/quality/files?offset=${offset}&limit=100`);
    qualityFiles.push(...(r.data?.files ?? []));
    if (!r.data?.files?.length || qualityFiles.length >= r.data.total) break;
  }
  fixtures['/api/quality/files'] = { status: 200, body: { total: qualityFiles.length, files: qualityFiles } };

  for (const id of Object.values(ids)) {
    await get(`/api/instances/${id}`);
    await get(`/api/instances/${id}/settings`);
  }

  const issues = await get('/api/issues?status=all');
  for (const i of issues ?? []) await get(`/api/issues/${encodeURIComponent(i.fingerprint)}`);

  const cleaner = await get('/api/cleaner');
  for (const inst of cleaner?.instances ?? []) {
    const id = encodeURIComponent(inst.instanceId);
    await get(`/api/cleaner/${id}/preview`);
    await get(`/api/cleaner/history?instance=${id}&limit=100`);
    await get(`/api/cleaner/activity?instance=${id}&days=14`);
  }

  const hunting = await get('/api/hunting');
  for (const inst of hunting?.instances ?? [])
    await get(`/api/hunting/${encodeURIComponent(inst.instanceId)}/filters`);

  for (const list of ['trending', 'movies', 'tv']) await get(`/api/discover?list=${list}&page=1`);
  for (const f of FILMS) await get(`/api/discover/movie/${f.tmdbId}`);
  for (const s of SERIES) await get(`/api/discover/tv/${s.tmdbId}`);

  for (const status of ['all', 'pending', 'approved', 'processing', 'available', 'failed', 'declined']) {
    await get(`/api/requests?status=${status}&take=20&skip=0`);
    await get(`/api/requests/mine?status=${status}&take=20&skip=0`);
  }

  const trash = await get('/api/trash');
  await get('/api/trash/history?limit=100');
  for (const product of ['radarr', 'sonarr']) await get(`/api/trash/catalog/${product}`);
  for (const inst of trash?.instances ?? [])
    if (inst.templateId) await get(`/api/trash/instances/${encodeURIComponent(inst.id)}/preview`);

  for (const range of ['24h', '7d', '30d', '90d']) await get(`/api/indexer-insights?range=${range}`);
  await get('/api/indexer-insights/priorities');
  for (const days of [30, 90, 365]) await get(`/api/storage?days=${days}`);

  for (const days of [7, 30, 90, 365]) {
    await get(`/api/library?days=${days}`);
    await get(`/api/stats?days=${days}`);
  }

  // The calendar asks for ranges around the visitor's today. The demo cuts
  // them out of one recording that spans about five weeks.
  const calendarQuery = new URLSearchParams({
    start: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    end: new Date(Date.now() + 29 * 86_400_000).toISOString(),
  });
  await get(`/api/calendar?${calendarQuery}`);
  fixtures['/api/calendar'] = fixtures[`/api/calendar?${calendarQuery}`];
  delete fixtures[`/api/calendar?${calendarQuery}`];
  // An iCal link that a calendar app has already fetched. Its token is never recorded.
  const feed = await must('POST', '/api/calendar/feed');
  await fetch(`${BASE}${feed.path}`);
  await get('/api/calendar/feed');
  await get('/api/calendar/feeds');

  // The live trend and the issue timeline only have today's data on a fresh
  // server. The demo shows an invented hour and fortnight around those values.
  const overview = fixtures['/api/overview'].body;
  const trend = await get('/api/overview/trend');
  const wave = (i, base, spread) =>
    Math.max(0, Math.round(base + spread * Math.sin(i / 5) + spread * 0.4 * Math.sin(i / 1.7)));
  const nowMinute = Math.floor(Date.now() / 60_000) * 60_000;
  trend.points = Array.from({ length: 60 }, (_, i) => ({
    at: new Date(nowMinute - (59 - i) * 60_000).toISOString(),
    speed: i === 59 ? overview.stats.downloadSpeed : wave(i, overview.stats.downloadSpeed * 0.8, 18e6),
    downloads: i === 59 ? overview.stats.activeDownloads : Math.max(1, wave(i, 3, 1.5)),
    streams: i === 59 ? overview.stats.activeStreams : Math.min(4, wave(i + 20, 2, 1.4)),
  }));
  const timeline = await get('/api/issues/timeline?days=14');
  const past = [0, 1, 0, 2, 1, 0, 0, 3, 1, 0, 2, 1, 0];
  timeline.days = timeline.days.map((d, i) =>
    i < past.length ? { ...d, warning: past[i], info: i % 4 === 1 ? 1 : 0, critical: i === 7 ? 1 : 0 } : d,
  );

  // The same for the cleaner's fortnight: a few strikes, removals and imports.
  for (const [n, inst] of (cleaner?.instances ?? []).entries()) {
    const activity =
      fixtures[`/api/cleaner/activity?instance=${encodeURIComponent(inst.instanceId)}&days=14`];
    if (!activity?.body?.days) continue;
    activity.body.days = activity.body.days.map((d, i) =>
      i === 13
        ? d
        : {
            ...d,
            strikes: (i * 7 + n * 3) % 5,
            removed: (i + n) % 4 === 0 ? 1 : 0,
            imported: (i * 3 + n) % 6 === 0 ? 1 : 0,
          },
    );
  }

  // Hunting only has today's two searches; show an invented month of results.
  for (const [n, inst] of (fixtures['/api/hunting']?.body?.instances ?? []).entries()) {
    if (inst.pause) continue;
    const finished = 38 + n * 7;
    const found = Math.round(finished * (0.42 + n * 0.05));
    const imported = Math.round(found * 0.7);
    inst.stats = { searches: finished + 2, finished, found, imported, rate: found / finished };
  }

  // Answers to a few actions, so buttons in the demo show real results.
  const mutations = {};
  const radarr4k = encodeURIComponent(ids['radarr-4k']);
  const blocked = cleaner?.instances
    .find((i) => i.instanceId === ids['radarr-4k'])
    ?.downloads.find((d) => JSON.stringify(d).includes('DEMOIMPORT01'));
  const preview = await call('POST', `/api/cleaner/${radarr4k}/downloads/import-preview`, {
    key: blocked?.key,
  });
  mutations[`POST /api/cleaner/${radarr4k}/downloads/import-preview`] = {
    status: preview.status,
    body: preview.data,
  };
  const test = await call('POST', '/api/instances/test', {
    adapter: 'sonarr',
    baseUrl: `${MOCK}/sonarr`,
    fields: { apiKey: DEMO_KEY },
  });
  mutations['POST /api/instances/test'] = { status: test.status, body: test.data };
  const record = async (method, p, body) => {
    const r = await call(method, p, body);
    mutations[`${method} ${p}`] = { status: r.status, body: r.data };
  };
  const templates = trash?.templates ?? [];
  const movies = templates.find((x) => x.name === 'Movies HD');
  if (movies) await record('POST', '/api/trash/resolve', { product: 'radarr', config: movies.config });
  for (const key of ['radarr', 'radarr-4k', 'sonarr', 'sonarr-4k']) {
    const id = encodeURIComponent(ids[key]);
    await record('POST', `/api/trash/instances/${id}/suggest`);
  }
  await record('POST', `/api/trash/instances/${encodeURIComponent(ids.radarr)}/release-test`, {
    title: 'Nosferatu.1922.1080p.BluRay.x264-EXAMPLE',
  });

  // ----------------------------------------------------------- clean up
  let out = JSON.stringify({ capturedAt: new Date().toISOString(), fixtures, mutations }, null, 1);
  for (const [from, to] of HOSTS) out = out.split(from).join(to);
  // Stable ids keep a new capture's diff small.
  const uuids = new Map();
  out = out.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (id) => {
    if (!uuids.has(id)) uuids.set(id, `00000000-0000-4000-8000-${String(uuids.size + 1).padStart(12, '0')}`);
    return uuids.get(id);
  });
  out = out.replace(/"csrfToken": ?"[^"]*"/g, '"csrfToken": "demo"');
  if (out.includes('127.0.0.1')) console.warn('warning: a local address is left in the fixtures');
  if (out.includes(dataDir) || out.includes(tmpdir()))
    throw new Error('a local path is left in the fixtures');
  writeFileSync(OUT, `${out}\n`);
  console.log(`wrote ${Object.keys(fixtures).length} answers to ${path.relative(root, OUT)}`);
} finally {
  stop();
  rmSync(dataDir, { recursive: true, force: true });
}
