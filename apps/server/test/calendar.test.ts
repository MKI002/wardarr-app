// The calendar across instances and the iCal feed links. All titles are invented.
import { AdapterError, defineAdapter, type CalendarEntry } from '@wardarr/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildCalendar, foldLine, icsText } from '../src/calendar/ical.js';
import { mergeEntries, type CalendarItem } from '../src/calendar/service.js';
import { FAKE_KEY, authHeaders, createTestApp, setupAdmin } from './helpers.js';

const DAY = 86_400_000;
const soon = (days: number, hour = 20) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const soonDay = (days: number) => soon(days).slice(0, 10);

function entry(over: Partial<CalendarEntry>): CalendarEntry {
  return {
    id: 'episode:1',
    kind: 'episode',
    release: 'airing',
    title: 'Example Series',
    subtitle: 'Pilot',
    seasonNumber: 1,
    episodeNumber: 1,
    date: soon(2),
    allDay: false,
    runtimeMinutes: 45,
    hasFile: false,
    monitored: true,
    year: 2026,
    posterPath: null,
    tmdbId: 9001,
    network: null,
    overview: null,
    ...over,
  };
}

const state = {
  hd: [] as CalendarEntry[],
  uhd: [] as CalendarEntry[],
  uhdDown: false,
  calls: 0,
};

const credentials = z.object({ apiKey: z.string().min(1) });
const fakeArr = (id: string, pick: () => CalendarEntry[], down = () => false) =>
  defineAdapter({
    id,
    name: id === 'fakesonarr' ? 'Fake Sonarr' : 'Fake Sonarr 4K',
    category: 'arr',
    lifecycle: 'active',
    homepage: 'https://example.com',
    fields: [{ key: 'apiKey', kind: 'secret', label: 'fields.apiKey', required: true }],
    credentials,
    capabilities: ['health', 'calendar'],
    create() {
      return {
        testConnection: async () => ({ version: '4.0.0' }),
        health: async () => [],
        calendar: async () => {
          state.calls++;
          if (down()) throw new AdapterError('unreachable', 'down');
          return pick();
        },
      };
    },
  });

let t: Awaited<ReturnType<typeof createTestApp>>;
let admin: Record<string, string>;
let viewer: Record<string, string>;
let viewerId: string;

async function addInstance(adapter: string, name: string) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/instances',
    headers: admin,
    payload: { adapter, name, baseUrl: 'http://svc.example.test', fields: { apiKey: FAKE_KEY } },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

beforeAll(async () => {
  t = await createTestApp({
    adapters: [
      fakeArr('fakesonarr', () => state.hd),
      fakeArr(
        'fakesonarruhd',
        () => state.uhd,
        () => state.uhdDown,
      ),
    ],
    publicUrl: 'https://wardarr.example.test/',
  });
  admin = await setupAdmin(t);
  await addInstance('fakesonarr', 'Series');
  await addInstance('fakesonarruhd', 'Series 4K');
  const created = await t.app.inject({
    method: 'POST',
    url: '/api/users',
    headers: admin,
    payload: { username: 'viewer', password: 'viewer-password-1', role: 'user' },
  });
  viewerId = created.json().id;
  const login = await t.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'x-wardarr-request': '1' },
    payload: { username: 'viewer', password: 'viewer-password-1' },
  });
  viewer = authHeaders(login);
});
afterAll(async () => t.close());

const range = (from: number, to: number) =>
  `/api/calendar?start=${encodeURIComponent(new Date(Date.now() + from * DAY).toISOString())}&end=${encodeURIComponent(new Date(Date.now() + to * DAY).toISOString())}`;

describe('calendar', () => {
  it('merges the same release from two instances into one entry', async () => {
    state.hd = [
      entry({ id: 'episode:1' }),
      entry({ id: 'episode:2', episodeNumber: 2, subtitle: 'Second', date: soon(9) }),
    ];
    state.uhd = [
      entry({ id: 'episode:77', hasFile: true, posterPath: '/p.jpg' }),
      entry({
        id: 'movie:5:digital',
        kind: 'movie',
        release: 'digital',
        title: 'Example Film',
        subtitle: null,
        seasonNumber: undefined,
        episodeNumber: undefined,
        date: soonDay(4),
        allDay: true,
        tmdbId: 4005,
      }),
    ];
    const res = await t.app.inject({ url: range(-1, 30), headers: viewer });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { items: CalendarItem[]; sources: Array<{ name: string; error: null }> };
    expect(body.sources.map((s) => s.name).sort()).toEqual(['Series', 'Series 4K']);
    expect(body.items.map((i) => i.subtitle ?? i.title)).toEqual(['Pilot', 'Example Film', 'Second']);
    const pilot = body.items[0]!;
    expect(pilot.instances.map((i) => i.name).sort()).toEqual(['Series', 'Series 4K']);
    expect(pilot.hasFile).toBe(true);
    expect(pilot.posterPath).toBe('/p.jpg');
  });

  it('keeps entries of reachable instances when one fails', async () => {
    state.uhdDown = true;
    const res = await t.app.inject({ url: range(-2, 31), headers: viewer });
    const body = res.json() as { items: CalendarItem[]; sources: Array<{ name: string; error: string }> };
    expect(body.sources.find((s) => s.name === 'Series 4K')?.error).toBe('unreachable');
    expect(body.items).toHaveLength(2);
    state.uhdDown = false;
  });

  it('caches answers for a few minutes', async () => {
    const url = `/api/calendar?start=${soonDay(-1)}T00:00:00Z&end=${soonDay(20)}T00:00:00Z`;
    await t.app.inject({ url, headers: viewer });
    const before = state.calls;
    await t.app.inject({ url, headers: viewer });
    expect(state.calls).toBe(before);
  });

  it('rejects bad and overlong ranges', async () => {
    expect((await t.app.inject({ url: '/api/calendar?start=yesterday', headers: viewer })).statusCode).toBe(
      400,
    );
    const long = await t.app.inject({ url: range(0, 200), headers: viewer });
    expect(long.statusCode).toBe(400);
    expect(long.json().error).toBe('rangeTooLong');
  });

  it('shows the calendar tab to users', async () => {
    const res = await t.app.inject({ url: '/api/capabilities', headers: viewer });
    expect(res.json().tabs).toContain('calendar');
  });
});

describe('iCal feed', () => {
  let path = '';

  it('creates a feed link that works without a session', async () => {
    const created = await t.app.inject({ method: 'POST', url: '/api/calendar/feed', headers: viewer });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    path = body.path;
    expect(path).toMatch(/^\/api\/calendar\/ical\/[A-Za-z0-9_-]{43}\.ics$/);
    expect(body.url).toBe(`https://wardarr.example.test${path}`);

    const feed = await t.app.inject({ url: path });
    expect(feed.statusCode).toBe(200);
    expect(feed.headers['content-type']).toContain('text/calendar');
    expect(feed.body).toContain('BEGIN:VCALENDAR');
    expect(feed.body).toContain('SUMMARY:Example Series · S01E01 · Pilot');
    expect(feed.body).toContain(`DTSTART;VALUE=DATE:${soonDay(4).replace(/-/g, '')}`);
    expect(feed.body.split('BEGIN:VEVENT')).toHaveLength(4);

    const info = await t.app.inject({ url: '/api/calendar/feed', headers: viewer });
    expect(info.json().feed.lastUsedAt).not.toBeNull();
  });

  it('answers 404 for unknown tokens', async () => {
    const res = await t.app.inject({ url: `/api/calendar/ical/${'a'.repeat(43)}.ics` });
    expect(res.statusCode).toBe(404);
    expect((await t.app.inject({ url: '/api/calendar/ical/short.ics' })).statusCode).toBe(404);
  });

  it('replaces the old link when a new one is made', async () => {
    const created = await t.app.inject({ method: 'POST', url: '/api/calendar/feed', headers: viewer });
    expect((await t.app.inject({ url: path })).statusCode).toBe(404);
    path = created.json().path;
    expect((await t.app.inject({ url: path })).statusCode).toBe(200);
  });

  it('lets admins see and revoke every link', async () => {
    const list = await t.app.inject({ url: '/api/calendar/feeds', headers: admin });
    const feeds = list.json().feeds as Array<{ id: string; username: string; userId: string }>;
    expect(feeds.map((f) => f.username)).toEqual(['viewer']);
    expect((await t.app.inject({ url: '/api/calendar/feeds', headers: viewer })).statusCode).toBe(403);
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/calendar/feeds/${feeds[0]!.id}`,
      headers: admin,
    });
    expect(del.statusCode).toBe(204);
    expect((await t.app.inject({ url: path })).statusCode).toBe(404);
  });

  it('stops working when the user revokes it or is disabled', async () => {
    path = (await t.app.inject({ method: 'POST', url: '/api/calendar/feed', headers: viewer })).json().path;
    await t.app.inject({
      method: 'PATCH',
      url: `/api/users/${viewerId}`,
      headers: admin,
      payload: { disabled: true },
    });
    expect((await t.app.inject({ url: path })).statusCode).toBe(404);
    await t.app.inject({
      method: 'PATCH',
      url: `/api/users/${viewerId}`,
      headers: admin,
      payload: { disabled: false },
    });
    expect((await t.app.inject({ url: path })).statusCode).toBe(200);

    const adminFeed = (
      await t.app.inject({ method: 'POST', url: '/api/calendar/feed', headers: admin })
    ).json().path;
    const del = await t.app.inject({ method: 'DELETE', url: '/api/calendar/feed', headers: admin });
    expect(del.statusCode).toBe(204);
    expect((await t.app.inject({ url: adminFeed })).statusCode).toBe(404);
  });
});

describe('iCal format', () => {
  it('escapes text and folds long lines at 75 octets', () => {
    expect(icsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const folded = foldLine(`SUMMARY:${'ä'.repeat(60)}`);
    for (const line of folded.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'ä'.repeat(60)}`);
  });

  it('writes all-day releases as dates and airings with their runtime', () => {
    const items = mergeEntries([
      {
        instance: { id: 'i1', name: 'Films', adapter: 'radarr' },
        entries: [
          entry({
            id: 'movie:1:physical',
            kind: 'movie',
            release: 'physical',
            title: 'Example Film',
            subtitle: null,
            date: '2026-03-12',
            allDay: true,
          }),
          entry({ date: '2026-03-10T02:00:00.000Z', runtimeMinutes: 50 }),
        ],
      },
    ]);
    const ics = buildCalendar({ name: 'Wardarr', lang: 'de', items, now: new Date('2026-03-01T00:00:00Z') });
    expect(ics).toContain('DTSTART:20260310T020000Z\r\nDTEND:20260310T025000Z');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260312\r\nDTEND;VALUE=DATE:20260313');
    expect(ics).toContain('SUMMARY:Example Film (Blu-ray & DVD)');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });
});
