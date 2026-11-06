import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FAKE_KEY, createTestApp, fakeState, setupAdmin } from './helpers.js';

let t: Awaited<ReturnType<typeof createTestApp>>;
let headers: Record<string, string>;
beforeEach(async () => {
  t = await createTestApp();
  headers = await setupAdmin(t);
  fakeState.down = false;
  fakeState.signals = [];
});
afterEach(async () => t.close());

async function create(payload: Record<string, unknown>) {
  return t.app.inject({ method: 'POST', url: '/api/instances', headers, payload });
}

describe('instances', () => {
  it('never returns secrets, in any response', async () => {
    const res = await create({
      adapter: 'fake',
      name: 'Fake One',
      baseUrl: 'http://fake.example.test:8989/',
      fields: { apiKey: FAKE_KEY },
    });
    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain(FAKE_KEY);
    expect(res.json().fields.apiKey).toEqual({ isSet: true });
    expect(res.json().baseUrl).toBe('http://fake.example.test:8989');
    for (const url of ['/api/instances', `/api/instances/${res.json().id}`, '/api/overview']) {
      const r = await t.app.inject({ url, headers });
      expect(r.body, url).not.toContain(FAKE_KEY);
    }
  });

  it('encrypts secrets at rest', async () => {
    const res = await create({
      adapter: 'fake',
      name: 'Fake One',
      baseUrl: 'http://fake.example.test',
      fields: { apiKey: FAKE_KEY },
    });
    const row = t.store.get(res.json().id)!;
    expect(row.secretFields).toMatch(/^v1:/);
    expect(row.secretFields).not.toContain(FAKE_KEY);
    expect(t.store.credentials(row).apiKey).toBe(FAKE_KEY);
  });

  it('keeps the stored secret when an update leaves it empty', async () => {
    const res = await create({
      adapter: 'fake',
      name: 'Fake One',
      baseUrl: 'http://fake.example.test',
      fields: { apiKey: FAKE_KEY },
    });
    const id = res.json().id;
    await t.app.inject({
      method: 'PATCH',
      url: `/api/instances/${id}`,
      headers,
      payload: { name: 'Fake Two', fields: { apiKey: '' } },
    });
    expect(t.store.credentials(t.store.get(id)!).apiKey).toBe(FAKE_KEY);
  });

  it('rejects dangerous URLs', async () => {
    for (const baseUrl of [
      'ftp://fake.example.test',
      'http://user:pass@fake.example.test',
      'http://169.254.169.254/latest', // privacy-allow
      'http://[fe80::1]/',
      'http://metadata.google.internal/',
      'file:///etc/passwd',
    ]) {
      const res = await create({
        adapter: 'fake',
        name: `X ${baseUrl.length}`,
        baseUrl,
        fields: { apiKey: FAKE_KEY },
      });
      expect(res.statusCode, baseUrl).toBe(400);
    }
  });

  it('accepts LAN and loopback URLs', async () => {
    let n = 0;
    for (const baseUrl of [
      'http://192.168.1.20:8989', // privacy-allow
      'http://10.0.0.5', // privacy-allow
      'http://127.0.0.1:7878',
      'http://sonarr:8989',
    ]) {
      const res = await create({
        adapter: 'fake',
        name: `LAN ${n++}`,
        baseUrl,
        fields: { apiKey: FAKE_KEY },
      });
      expect(res.statusCode, baseUrl).toBe(201);
    }
  });

  it('requires unique names per instance', async () => {
    await create({
      adapter: 'fake',
      name: 'Same',
      baseUrl: 'http://a.example.test',
      fields: { apiKey: FAKE_KEY },
    });
    const res = await create({
      adapter: 'fake',
      name: 'Same',
      baseUrl: 'http://b.example.test',
      fields: { apiKey: FAKE_KEY },
    });
    expect(res.statusCode).toBe(409);
  });
});
