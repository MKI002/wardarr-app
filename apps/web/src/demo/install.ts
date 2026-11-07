// The public demo: the real web UI with the server replaced by recorded
// answers. Only the demo build (`vite build --mode demo`) includes this
// module; see docs/demo.md.
//
// The answers in fixtures.json were recorded from a real Wardarr server that
// talked to invented services (scripts/demo/capture.mjs). Timestamps are
// moved forward to today, so "3 minutes ago" stays 3 minutes ago. Changes a
// visitor makes live in memory and are gone after a reload.
import i18n from '../lib/i18n';
import { setDemoPosters } from '../lib/media';
import recording from './fixtures.json';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface Answer {
  status: number;
  body: Json;
}

const data = recording as unknown as {
  capturedAt: string;
  fixtures: Record<string, Answer>;
  mutations: Record<string, Answer>;
};

const posterFiles = import.meta.glob<string>('./posters/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});

// ------------------------------------------------------------------ time

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Moves recorded timestamps to today. Release dates and far-future values stay. */
function shiftTimes(value: Json, shift: number, capturedAt: number): Json {
  if (typeof value === 'string') {
    const isIso = ISO.test(value);
    if (!isIso && !DATE.test(value)) return value;
    const t = Date.parse(isIso ? value : `${value}T12:00:00Z`);
    if (t < capturedAt - 400 * DAY || t > capturedAt + 30 * DAY) return value;
    if (isIso) return new Date(t + shift).toISOString();
    return new Date(t + Math.round(shift / DAY) * DAY).toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) return value.map((v) => shiftTimes(v, shift, capturedAt));
  if (value && typeof value === 'object') {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) out[k] = shiftTimes(v, shift, capturedAt);
    return out;
  }
  return value;
}

// ---------------------------------------------------------------- answers

const capturedAt = Date.parse(data.capturedAt);
const shift = Date.now() - capturedAt;
const answers = new Map<string, Answer>();
for (const [key, answer] of Object.entries(data.fixtures)) {
  answers.set(normalize(key), shiftTimes(answer as unknown as Json, shift, capturedAt) as unknown as Answer);
}
const recordedMutations = data.mutations;

/** Path plus sorted query, so the order of parameters does not matter. */
function normalize(pathAndQuery: string): string {
  const url = new URL(pathAndQuery, 'http://demo.invalid');
  const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const query = new URLSearchParams(params).toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

const ok = (body: Json = { ok: true }, status = 200): Answer => ({ status, body });
const notFound = (): Answer => ({ status: 404, body: { error: 'notFound' } });
const body = (key: string): Json | undefined => answers.get(key)?.body;
const obj = (v: Json | undefined): Record<string, Json> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const list = (v: Json | undefined): Json[] => (Array.isArray(v) ? v : []);

/** Applies `change` to every recorded answer under a path prefix. */
function updateAll(prefix: string, change: (body: Json) => Json) {
  for (const [key, answer] of answers) {
    if (key.startsWith(prefix)) answers.set(key, { ...answer, body: change(answer.body) });
  }
}

// --------------------------------------------------------------------- GET

function get(path: string, url: URL): Answer {
  const exact = answers.get(normalize(`${path}${url.search}`));
  if (exact) return exact;
  // The recording was made in UTC; answers asked for another time zone use it.
  // A forced refresh ("Update now") answers with the recorded numbers too.
  if (url.searchParams.has('tz') || url.searchParams.has('refresh')) {
    const utc = new URL(url);
    utc.searchParams.delete('tz');
    utc.searchParams.delete('refresh');
    const answer = answers.get(normalize(`${path}${utc.search}`));
    if (answer) return answer;
  }

  // The calendar is recorded once; every range is cut out of that recording.
  if (path === '/api/calendar') return calendarRange(url);

  // Search runs over everything Discover knows.
  if (path === '/api/discover/search') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const trending = obj(body('/api/discover?list=trending&page=1'));
    const results = list(trending.results).filter((r) =>
      String(obj(r).title ?? '')
        .toLowerCase()
        .includes(q),
    );
    return ok({ ...trending, page: 1, totalPages: 1, results });
  }
  // Later pages of a list are empty: the demo fits on the first page.
  const page = url.searchParams.get('page') ?? url.searchParams.get('skip');
  if (page && page !== '1' && page !== '0') {
    const first = new URL(url);
    first.searchParams.set(
      url.searchParams.has('page') ? 'page' : 'skip',
      url.searchParams.has('page') ? '1' : '0',
    );
    const answer = answers.get(normalize(`${path}${first.search}`));
    if (answer) return ok({ ...obj(answer.body), results: [] });
  }
  return notFound();
}

/**
 * The calendar recording, moved by whole days only, so episodes keep their
 * air time ("20:00") instead of drifting with the time of the visit.
 */
const calendar = (() => {
  const recorded = data.fixtures['/api/calendar'];
  if (!recorded) return null;
  const days = Math.round(shift / DAY) * DAY;
  return shiftTimes(recorded.body, days, capturedAt) as unknown as {
    sources: Json[];
    items: Array<{ date: string; allDay: boolean }>;
  };
})();

function calendarRange(url: URL): Answer {
  if (!calendar) return ok({ sources: [], items: [] });
  const start = Date.parse(url.searchParams.get('start') ?? '') || 0;
  const end = Date.parse(url.searchParams.get('end') ?? '') || Infinity;
  const items = calendar.items.filter((i) => {
    const t = Date.parse(i.allDay ? `${i.date.slice(0, 10)}T00:00:00Z` : i.date);
    return t + (i.allDay ? DAY : 0) >= start && t <= end;
  });
  return ok({ sources: calendar.sources, items: items as unknown as Json });
}

// ----------------------------------------------------------------- changes

function setRequestStatus(id: number, status: string) {
  updateAll('/api/requests', (b) => {
    const page = obj(b);
    if (!Array.isArray(page.results)) return b;
    return {
      ...page,
      results: page.results.map((r) => (obj(r).id === id ? { ...obj(r), status } : r)),
    };
  });
}

function setIssue(fp: string, change: (issue: Record<string, Json>) => Record<string, Json>): Json {
  let changed: Json = null;
  updateAll('/api/issues', (b) => {
    if (Array.isArray(b)) return b.map((i) => (obj(i).fingerprint === fp ? (changed = change(obj(i))) : i));
    return obj(b).fingerprint === fp ? (changed = change(obj(b))) : b;
  });
  return changed;
}

/** Backups in the demo: the slider, pins and deleting work in memory. */
function backupMutation(method: string, path: string, input: Record<string, Json>): Answer {
  const overview = obj(body('/api/backups'));
  const backups = list(overview.backups).map(obj);
  const save = (next: Record<string, Json>) => {
    answers.set('/api/backups', ok(next));
    return ok(next);
  };
  if (path === '/api/backups/settings')
    return save({ ...overview, level: input.level ?? overview.level ?? 2 });
  const item = path.match(/^\/api\/backups\/([^/]+)(?:\/(pin))?$/);
  if (item && method === 'DELETE') {
    const id = decodeURIComponent(item[1]!);
    save({ ...overview, backups: backups.filter((b) => b.id !== id) });
    return ok();
  }
  if (item?.[2] === 'pin') {
    const id = decodeURIComponent(item[1]!);
    save({ ...overview, backups: backups.map((b) => (b.id === id ? { ...b, pinned: !!input.pinned } : b)) });
    return ok();
  }
  // Making, uploading, exporting and restoring need a real server.
  return { status: 409, body: { error: 'demo' } };
}

async function mutate(method: string, path: string, init: RequestInit | undefined): Promise<Answer> {
  const recorded = recordedMutations[`${method} ${path}`];
  if (recorded) return recorded;
  const input = obj(typeof init?.body === 'string' ? (JSON.parse(init.body) as Json) : null);

  if (path === '/api/auth/logout') return ok(null, 204);
  // A made-up link: the demo has no server that could answer it.
  if (path === '/api/calendar/feed') {
    if (method === 'DELETE') {
      answers.set('/api/calendar/feed', ok({ feed: null }));
      return ok(null, 204);
    }
    const feed = { id: 'demo-feed', createdAt: new Date().toISOString(), lastUsedAt: null };
    answers.set('/api/calendar/feed', ok({ feed }));
    return ok({ feed, path: `/api/calendar/ical/${'demo'.repeat(10)}abc.ics`, url: null }, 201);
  }
  if (path === '/api/auth/me/preferences') {
    const me = obj(body('/api/auth/me'));
    const user = obj(me.user);
    const next = { ...me, user: { ...user, preferences: { ...obj(user.preferences), ...input } } };
    answers.set('/api/auth/me', ok(next));
    return ok(next.user.preferences);
  }

  if (path.startsWith('/api/backups')) return backupMutation(method, path, input);

  // The priority watchdog: settings change in memory, a run shows the recorded preview.
  if (path === '/api/indexer-insights/priorities') {
    const view = obj(body(path));
    const next = { ...view, config: { ...obj(view.config), ...input } };
    answers.set(path, ok(next));
    return ok(next);
  }
  if (path === '/api/indexer-insights/priorities/run') {
    const view = obj(body('/api/indexer-insights/priorities'));
    return ok({ run: view.lastRun ?? null, view });
  }

  const issue = path.match(/^\/api\/issues\/([^/]+)\/(mute|unmute|recheck)$/);
  if (issue) {
    const fp = decodeURIComponent(issue[1]!);
    const action = issue[2];
    const minutes = typeof input.minutes === 'number' ? input.minutes : null;
    const until = minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : null;
    const changed = setIssue(fp, (i) =>
      action === 'recheck'
        ? i
        : action === 'mute'
          ? { ...i, muted: true, mutedUntil: until, mutedForever: !until }
          : { ...i, muted: false, mutedUntil: null, mutedForever: false },
    );
    return changed ? ok(changed) : notFound();
  }

  const request = path.match(/^\/api\/requests\/[^/]+\/(\d+)\/(approve|decline|retry)$/);
  if (request) {
    const status = { approve: 'approved', decline: 'declined', retry: 'approved' }[request[2]!]!;
    setRequestStatus(Number(request[1]), status);
    return ok();
  }

  if (path === '/api/requests' && method === 'POST') {
    const tmdbId = input.tmdbId;
    const key = input.is4k ? 'status4k' : 'status';
    updateAll('/api/discover', (b) => {
      const mark = (item: Json) =>
        obj(item).tmdbId === tmdbId ? { ...obj(item), [key]: 'requested' } : item;
      const page = obj(b);
      if (Array.isArray(page.results)) return { ...page, results: page.results.map(mark) };
      return mark(b);
    });
    return ok({ ok: true }, 201);
  }

  return ok();
}

// ----------------------------------------------------------- installation

class DemoEventSource {
  readonly url: string;
  readyState = 1;
  onmessage = null;
  onerror = null;
  onopen = null;
  constructor(url: string | URL) {
    this.url = String(url);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.readyState = 2;
  }
}

function banner() {
  const de = i18n.language === 'de';
  const bar = document.createElement('div');
  bar.setAttribute('role', 'note');
  bar.style.cssText =
    'display:flex;flex-wrap:wrap;justify-content:center;gap:4px 12px;padding:6px 16px;font:500 13px/1.4 system-ui,sans-serif;' +
    'background:var(--accent);color:var(--accent-contrast);text-align:center';
  const text = document.createElement('span');
  text.textContent = de
    ? 'Demo mit erfundenen Diensten und gemeinfreien Filmen. Änderungen bleiben nur bis zum Neuladen.'
    : 'Demo with invented services and public-domain films. Changes last until you reload.';
  const link = document.createElement('a');
  link.href = 'https://github.com/MKI002/wardarr-app';
  link.textContent = de ? 'Wardarr auf GitHub' : 'Wardarr on GitHub';
  link.style.cssText = 'color:inherit;text-decoration:underline;text-underline-offset:2px';
  bar.append(text, link);
  document.body.prepend(bar);
}

export function installDemo(): void {
  const posters: Record<string, string> = {};
  for (const [file, url] of Object.entries(posterFiles)) {
    posters[file.replace(/^.*\//, '').replace(/\.svg$/, '')] = url;
  }
  setDemoPosters(posters);

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/'))
      return realFetch(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const answer = method === 'GET' ? get(url.pathname, url) : await mutate(method, url.pathname, init);
    // A short pause, so loading states look like they do against a server.
    await new Promise((r) => setTimeout(r, method === 'GET' ? 120 : 250));
    if (answer.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  window.EventSource = DemoEventSource as unknown as typeof EventSource;
  banner();
}
