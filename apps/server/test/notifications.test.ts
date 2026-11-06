// Notifications: channel settings, secrets, SSRF checks, and what is sent
// when issues open and resolve. All addresses and tokens are invented.
import type { Signal } from '@wardarr/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FAKE_KEY, createTestApp, fakeState, setupAdmin } from './helpers.js';

const INDEXER: Signal = {
  origin: 'service',
  instance: { id: '', name: '', adapter: 'fake' },
  kind: 'health',
  source: 'IndexerLongTermStatusCheck',
  level: 'warning',
  message: 'Indexers unavailable due to failures for more than 6 hours: ExampleIndexer (Prowlarr)',
};

type Sent = { baseUrl: string; request: { path: string; headers?: Record<string, string>; json?: unknown } };
let sent: Sent[];
let status: number;
let grace: number;
let t: Awaited<ReturnType<typeof createTestApp>>;
let headers: Record<string, string>;
let instanceId: string;

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

async function setup(graceMs: number) {
  grace = graceMs;
  t = await createTestApp({
    publicUrl: 'https://wardarr.example.test',
    notificationOptions: {
      graceMs: grace,
      retryMs: 1,
      send: async (out) => {
        sent.push(out as Sent);
        return { status };
      },
    },
  });
  headers = await setupAdmin(t);
  fakeState.down = false;
  fakeState.signals = [];
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/instances',
    headers,
    payload: {
      adapter: 'fake',
      name: 'Fake Sonarr',
      baseUrl: 'http://fake.example.test',
      fields: { apiKey: FAKE_KEY },
    },
  });
  instanceId = res.json().id;
  await t.runtime.poll(instanceId);
}

const channel = (over: Record<string, unknown> = {}) =>
  t.app.inject({
    method: 'POST',
    url: '/api/notifications',
    headers,
    payload: {
      name: 'Phone',
      kind: 'ntfy',
      config: { server: 'https://ntfy.example.test', topic: 'example-topic' },
      secret: { token: 'tk_example_token' },
      events: { issueOpened: 'warning', issueResolved: true, requestPending: true },
      ...over,
    },
  });

beforeEach(() => {
  sent = [];
  status = 200;
});
afterEach(async () => t.close());

describe('notification channels', () => {
  beforeEach(() => setup(0));

  it('never returns secrets', async () => {
    const res = await channel();
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain('tk_example_token');
    expect(res.json().secrets).toEqual({ token: { isSet: true } });
    const list = await t.app.inject({ url: '/api/notifications', headers });
    expect(list.body).not.toContain('tk_example_token');
  });

  it('keeps a secret when it is left empty on update', async () => {
    const { id } = (await channel()).json();
    const res = await t.app.inject({
      method: 'PUT',
      url: `/api/notifications/${id}`,
      headers,
      payload: {
        name: 'Phone',
        kind: 'ntfy',
        config: { server: 'https://ntfy.example.test', topic: 'other-topic' },
        secret: { token: '' },
        events: { issueOpened: 'critical', issueResolved: false, requestPending: false },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().secrets.token.isSet).toBe(true);
    await t.app.inject({ method: 'POST', url: `/api/notifications/${id}/test`, headers });
    expect(sent[0]?.request.headers?.authorization).toBe('Bearer tk_example_token');
  });

  it('blocks metadata and link-local addresses', async () => {
    const res = await channel({
      kind: 'webhook',
      config: { url: 'http://metadata.google.internal/latest' },
      secret: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalidUrl');
  });

  it('sends a test and reports failures', async () => {
    const { id } = (await channel()).json();
    status = 403;
    const res = await t.app.inject({ method: 'POST', url: `/api/notifications/${id}/test`, headers });
    expect(res.json()).toEqual({ ok: false, error: 'unauthorized' });
    expect((await t.app.inject({ url: '/api/notifications', headers })).json().channels[0].lastError).toBe(
      'unauthorized',
    );
  });

  it('announces a new issue with a link, then its resolution', async () => {
    await channel();
    fakeState.signals = [INDEXER];
    await t.runtime.poll(instanceId);
    await tick();
    expect(sent).toHaveLength(1);
    const body = sent[0]!.request.json as Record<string, unknown>;
    expect(sent[0]!.baseUrl).toBe('https://ntfy.example.test');
    expect(body).toMatchObject({ topic: 'example-topic', priority: 4 });
    expect(String(body.title)).toContain('ExampleIndexer');
    expect(body.click).toBe('https://wardarr.example.test/issues?focus=indexer-unavailable%3Aexampleindexer');

    fakeState.signals = [];
    await t.runtime.poll(instanceId);
    await tick();
    expect(sent).toHaveLength(2);
    expect(String((sent[1]!.request.json as Record<string, unknown>).title)).toMatch(/^Resolved: /);
  });

  it('respects the severity threshold and the language', async () => {
    await channel({ events: { issueOpened: 'critical', issueResolved: true, requestPending: false } });
    await channel({
      name: 'German',
      language: 'de',
      events: { issueOpened: 'info', issueResolved: false, requestPending: false },
    });
    fakeState.signals = [INDEXER];
    await t.runtime.poll(instanceId);
    await tick();
    expect(sent).toHaveLength(1);
    fakeState.signals = [];
    await t.runtime.poll(instanceId);
    await tick();
    expect(sent).toHaveLength(1);
  });

  it('formats Discord, Telegram, Gotify and signed webhooks', async () => {
    await channel({
      name: 'Discord',
      kind: 'discord',
      config: {},
      secret: { webhookUrl: 'https://discord.example.test/api/webhooks/1/abc' },
    });
    await channel({
      name: 'Telegram',
      kind: 'telegram',
      config: { chatId: '-100' },
      secret: { botToken: '1:example' },
    });
    await channel({
      name: 'Gotify',
      kind: 'gotify',
      config: { server: 'http://gotify.example.test' },
      secret: { appToken: 'app-example' },
    });
    await channel({
      name: 'Hook',
      kind: 'webhook',
      config: { url: 'http://hook.example.test/in' },
      secret: { signingSecret: 'sig' },
    });
    await t.app.inject({
      method: 'DELETE',
      url: `/api/notifications/${(await t.app.inject({ url: '/api/notifications', headers })).json().channels.find((c: { name: string }) => c.name === 'Phone')?.id ?? 'none'}`,
      headers,
    });
    fakeState.signals = [INDEXER];
    await t.runtime.poll(instanceId);
    await tick();
    const by = (base: string) => sent.find((s) => s.baseUrl === base)!;
    expect(by('https://discord.example.test').request.path).toBe('/api/webhooks/1/abc');
    expect(by('https://api.telegram.org').request.path).toBe('/bot1:example/sendMessage');
    expect(by('http://gotify.example.test').request).toMatchObject({
      path: '/message',
      headers: { 'x-gotify-key': 'app-example' },
    });
    expect(by('http://hook.example.test').request.headers?.['x-wardarr-signature']).toMatch(
      /^sha256=[0-9a-f]{64}$/,
    );
  });

  it('is admin only', async () => {
    await t.app.inject({
      method: 'POST',
      url: '/api/users',
      headers,
      payload: { username: 'viewer', password: 'viewer-password-1', role: 'user' },
    });
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-wardarr-request': '1' },
      payload: { username: 'viewer', password: 'viewer-password-1' },
    });
    const cookie = login.cookies.find((c) => c.name === 'wardarr_session')!;
    const res = await t.app.inject({
      url: '/api/notifications',
      headers: { cookie: `wardarr_session=${cookie.value}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('grace period', () => {
  beforeEach(() => setup(60_000));

  it('stays quiet about a problem that fixes itself quickly', async () => {
    await channel();
    fakeState.signals = [INDEXER];
    await t.runtime.poll(instanceId);
    fakeState.signals = [];
    await t.runtime.poll(instanceId);
    await tick();
    expect(sent).toHaveLength(0);
  });
});
