// Transcode servers: history, node memory, stuck jobs and issues. The
// adapter is a fake with invented data.
import { defineAdapter, type TranscodeNode, type TranscodeStatus } from '@wardarr/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createTestApp, setupAdmin } from './helpers.js';

const node = (id: string, progress: number | null): TranscodeNode => ({
  id,
  name: `Node ${id.toUpperCase()}`,
  paused: false,
  limits: { transcodeCpu: 1, transcodeGpu: 1, healthCheckCpu: 1, healthCheckGpu: 0 },
  cpuPercent: 40,
  memoryUsedBytes: null,
  memoryTotalBytes: null,
  workers:
    progress === null
      ? []
      : [
          {
            id: `${id}-w1`,
            kind: 'transcode',
            gpu: true,
            file: '/media/movies/Example Film.mkv',
            progress,
            fps: 90,
            eta: '0:10:00',
            step: 'Processing',
            startedAt: null,
            originalBytes: 8e9,
            estimatedBytes: 3e9,
          },
        ],
});

const state: { status: TranscodeStatus } = { status: { nodes: [], totals: null } };

const fakeTdarr = defineAdapter({
  id: 'faketdarr',
  name: 'Fake Tdarr',
  category: 'transcoder',
  lifecycle: 'active',
  homepage: 'https://example.com',
  fields: [],
  credentials: z.object({}),
  capabilities: ['health', 'transcoding'],
  create() {
    return {
      testConnection: async () => ({ version: '2.27.01' }),
      health: async () => [],
      transcoding: async () => structuredClone(state.status),
      transcodeLibraries: async () => [
        {
          id: 'lib',
          name: 'Movies',
          folder: '/media/movies',
          files: 10,
          transcodes: 4,
          healthChecks: 9,
          savedBytes: 5e9,
        },
      ],
      transcodeFailures: async () => [
        { file: '/media/movies/Sample.mkv', kind: 'transcode', outcome: 'error', at: null, sizeBytes: 1e9 },
      ],
    };
  },
});

const totals = (transcodes: number, failed: number): TranscodeStatus['totals'] => ({
  files: 100,
  transcodes,
  healthChecks: 90,
  savedBytes: transcodes * 1e9,
  queued: { transcode: 5, healthCheck: 2 },
  done: { transcode: transcodes, healthCheck: 88 },
  failed: { transcode: failed, healthCheck: 0 },
});

let t: Awaited<ReturnType<typeof createTestApp>>;
let headers: Record<string, string>;
let id: string;
let clock: number;

const tick = (minutes: number) => {
  clock += minutes * 60_000;
  vi.setSystemTime(clock);
};

async function openIssues() {
  const list = (await t.app.inject({ url: '/api/issues', headers })).json() as Array<{ fingerprint: string }>;
  return list.map((i) => i.fingerprint.split(':')[0]).sort();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock = Date.parse('2026-03-02T10:00:00Z');
  vi.setSystemTime(clock);
  state.status = { nodes: [node('a', 0.2), node('b', null)], totals: totals(10, 0) };
  t = await createTestApp({ adapters: [fakeTdarr] });
  headers = await setupAdmin(t);
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/instances',
    headers,
    payload: { adapter: 'faketdarr', name: 'Tdarr', baseUrl: 'http://tdarr.example.test', fields: {} },
  });
  id = res.json().id;
  await t.runtime.poll(id);
});
afterEach(async () => {
  await t.close();
  vi.useRealTimers();
});

describe('transcoding', () => {
  it('shows the Tdarr tab and the server view', async () => {
    const caps = (await t.app.inject({ url: '/api/capabilities', headers })).json();
    expect(caps.tabs).toContain('tdarr');
    const view = (await t.app.inject({ url: '/api/tdarr', headers })).json();
    expect(view.instances).toHaveLength(1);
    const inst = view.instances[0];
    expect(inst.nodes.map((n: { name: string }) => n.name)).toEqual(['Node A', 'Node B']);
    expect(inst.totals.transcodes).toBe(10);
    expect(inst.libraries[0].name).toBe('Movies');
    expect(inst.failures).toHaveLength(1);
    expect(inst.history).toHaveLength(30);
    expect(await openIssues()).toEqual([]);
  });

  it('builds a daily history from the running totals', async () => {
    tick(24 * 60);
    state.status.totals = totals(16, 0);
    await t.runtime.poll(id);
    const inst = (await t.app.inject({ url: '/api/tdarr', headers })).json().instances[0];
    const last = inst.history.at(-1);
    expect(last).toMatchObject({ day: '2026-03-03', transcodes: 6, savedBytes: 6e9 });
    expect(inst.history.at(-2)).toMatchObject({ day: '2026-03-02', transcodes: 0 });
  });

  it('opens an issue for failed files and makes a burst critical', async () => {
    state.status.totals = totals(10, 2);
    await t.runtime.poll(id);
    expect(await openIssues()).toEqual(['transcode-failures']);
    tick(24 * 60);
    state.status.totals = totals(10, 14);
    await t.runtime.poll(id);
    const issue = (await t.app.inject({ url: '/api/issues', headers })).json()[0];
    expect(issue.group.severity).toBe('critical');
  });

  it('notices a node that went away and resolves when it is back', async () => {
    state.status.nodes = [node('a', 0.2)];
    tick(1);
    await t.runtime.poll(id);
    expect(await openIssues()).toEqual([]);
    tick(5);
    await t.runtime.poll(id);
    expect(await openIssues()).toEqual(['transcode-node-offline']);
    const inst = (await t.app.inject({ url: '/api/tdarr', headers })).json().instances[0];
    expect(inst.offline.map((n: { name: string }) => n.name)).toEqual(['Node B']);
    state.status.nodes = [node('a', 0.3), node('b', null)];
    tick(1);
    await t.runtime.poll(id);
    expect(await openIssues()).toEqual([]);
  });

  it('knows a node again after a restart gave it a new session id', async () => {
    // Tdarr hands out a new id each time a node starts; the name stays.
    const restarted = (id: string, name: string, progress: number | null) => ({
      ...node(id, progress),
      name,
    });
    state.status.nodes = [node('a', 0.2), restarted('b-2', 'Node B', null)];
    tick(5);
    await t.runtime.poll(id);
    expect(await openIssues()).toEqual([]);
    let inst = (await t.app.inject({ url: '/api/tdarr', headers })).json().instances[0];
    expect(inst.offline).toEqual([]);

    // Away again after two sessions: one issue, not one per old session.
    state.status.nodes = [node('a', 0.3)];
    tick(5);
    await t.runtime.poll(id);
    expect(await openIssues()).toEqual(['transcode-node-offline']);
    inst = (await t.app.inject({ url: '/api/tdarr', headers })).json().instances[0];
    expect(inst.offline.map((n: { id: string }) => n.id)).toEqual(['b-2']);

    state.status.nodes = [node('a', 0.4), restarted('b-3', 'Node B', null)];
    tick(1);
    await t.runtime.poll(id);
    expect(await openIssues()).toEqual([]);
  });

  it('warns when no node is connected at all', async () => {
    const fresh = await createTestApp({ adapters: [fakeTdarr] });
    const h = await setupAdmin(fresh);
    state.status = { nodes: [], totals: totals(0, 0) };
    const res = await fresh.app.inject({
      method: 'POST',
      url: '/api/instances',
      headers: h,
      payload: { adapter: 'faketdarr', name: 'Tdarr 2', baseUrl: 'http://tdarr2.example.test', fields: {} },
    });
    await fresh.runtime.poll(res.json().id);
    const list = (await fresh.app.inject({ url: '/api/issues', headers: h })).json();
    expect(list.map((i: { fingerprint: string }) => i.fingerprint.split(':')[0])).toEqual([
      'transcode-no-nodes',
    ]);
    await fresh.close();
  });

  it('finds jobs that stopped moving', async () => {
    tick(20);
    await t.runtime.poll(id);
    expect(await openIssues()).toEqual([]);
    tick(15);
    await t.runtime.poll(id);
    expect(await openIssues()).toEqual(['transcode-stuck']);
    const inst = (await t.app.inject({ url: '/api/tdarr', headers })).json().instances[0];
    expect(inst.nodes[0].workers[0].stuckMinutes).toBe(35);
    state.status.nodes = [node('a', 0.25), node('b', null)];
    tick(1);
    await t.runtime.poll(id);
    expect(await openIssues()).toEqual([]);
  });
});
