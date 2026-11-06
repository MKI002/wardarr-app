// End-to-end flow inside the server: poll, open an issue, recheck, resolve.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FAKE_KEY, createTestApp, fakeState, setupAdmin } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let headers: Record<string, string>;
let instanceId: string;

beforeEach(async () => {
  t = await createTestApp();
  headers = await setupAdmin(t);
  fakeState.down = false;
  fakeState.signals = [
    {
      origin: 'service',
      instance: { id: '', name: '', adapter: 'fake' },
      kind: 'health',
      source: 'IndexerLongTermStatusCheck',
      level: 'warning',
      message: 'Indexers unavailable due to failures for more than 6 hours: ExampleIndexer (Prowlarr)',
    },
  ];
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
});
afterEach(async () => t.close());

async function openIssues() {
  return (await t.app.inject({ url: '/api/issues', headers })).json() as Array<{
    fingerprint: string;
    status: string;
  }>;
}

describe('issue flow', () => {
  it('opens an issue from a health message', async () => {
    const issues = await openIssues();
    expect(issues.map((i) => i.fingerprint)).toEqual(['indexer-unavailable:exampleindexer']);
  });

  it('keeps the issue while the instance is unreachable, and adds a connection issue', async () => {
    fakeState.down = true;
    fakeState.signals = [];
    await t.runtime.poll(instanceId);
    const fps = (await openIssues()).map((i) => i.fingerprint).sort();
    expect(fps).toEqual(['indexer-unavailable:exampleindexer', `instance-unreachable:${instanceId}`]);
  });

  it('recheck resolves a fixed issue immediately and keeps it in history', async () => {
    fakeState.signals = [];
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/issues/indexer-unavailable:exampleindexer/recheck',
      headers,
    });
    expect(res.json().status).toBe('resolved');
    expect(await openIssues()).toHaveLength(0);
    const detail = await t.app.inject({ url: '/api/issues/indexer-unavailable:exampleindexer', headers });
    expect(detail.json().history.map((h: { type: string }) => h.type)).toEqual(['resolved', 'opened']);
  });

  it('mutes for a limited time and forever', async () => {
    const fp = 'indexer-unavailable:exampleindexer';
    const timed = await t.app.inject({
      method: 'POST',
      url: `/api/issues/${fp}/mute`,
      headers,
      payload: { minutes: 60 },
    });
    expect(timed.json().muted).toBe(true);
    expect(timed.json().mutedForever).toBe(false);
    const forever = await t.app.inject({
      method: 'POST',
      url: `/api/issues/${fp}/mute`,
      headers,
      payload: {},
    });
    expect(forever.json().mutedForever).toBe(true);
    const overview = await t.app.inject({ url: '/api/overview', headers });
    expect(overview.json().issues.needsAttention).toHaveLength(0);
  });

  it('resolves issues of a deleted instance', async () => {
    await t.app.inject({ method: 'DELETE', url: `/api/instances/${instanceId}`, headers });
    expect(await openIssues()).toHaveLength(0);
  });
});
