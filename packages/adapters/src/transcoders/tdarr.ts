// Tdarr: a transcode server with nodes that run transcode and health check
// workers. Wardarr reads what the nodes do, the server's totals, the
// libraries and recent failures. It never starts, stops or requeues jobs.
import {
  AdapterError,
  defineAdapter,
  type AdapterContext,
  type Signal,
  type StorageFolder,
  type TranscodeFailure,
  type TranscodeLibrary,
  type TranscodeNode,
  type TranscodeTotals,
  type TranscodeWorker,
  type TranscodeWorkerLimits,
} from '@wardarr/core';
import { z } from 'zod';
import { compatSignal, detectionCache, majorOf, type ApiDetection } from '../shared/apiVersion.js';
import { jsonOf } from '../shared/http.js';
import { folder, part } from '../shared/topology.js';

/** Tdarr reports sizes in gigabytes. */
const GB = 1024 ** 3;

/**
 * Tdarr majors Wardarr was tested with; others run in compatibility mode.
 * Tdarr 3 is the server rewritten in Rust; it keeps the v2 API and its
 * `x-api-key` header, but switches authentication on for new installs.
 */
const TESTED_MAJORS = { min: 2, max: 3 };

/** Per-library statistics have their own endpoint from this version on. */
const PIES_ENDPOINT_FROM = [2, 24, 1] as const;

interface StatusResponse {
  status?: string;
  version?: string;
  os?: string;
  uptime?: number;
}

interface RawWorker {
  _id?: string;
  workerType?: string;
  idle?: boolean;
  file?: string;
  percentage?: number;
  fps?: number;
  ETA?: string;
  status?: string;
  originalfileSizeInGbytes?: number;
  estSize?: number;
  job?: { start?: number };
}

interface RawNode {
  _id?: string;
  nodeName?: string;
  nodePaused?: boolean;
  workers?: Record<string, RawWorker>;
  workerLimits?: Partial<
    Record<'transcodecpu' | 'transcodegpu' | 'healthcheckcpu' | 'healthcheckgpu', number>
  >;
  resStats?: {
    os?: { cpuPerc?: string | number; memUsedGB?: string | number; memTotalGB?: string | number };
  };
}

interface RawStatistics {
  totalFileCount?: number;
  totalTranscodeCount?: number;
  totalHealthCheckCount?: number;
  /** Gigabytes saved. */
  sizeDiff?: number | string;
  table1Count?: number;
  table2Count?: number;
  table3Count?: number;
  table4Count?: number;
  table5Count?: number;
  table6Count?: number;
  table1ViewableCount?: number;
  table2ViewableCount?: number;
  table3ViewableCount?: number;
  table4ViewableCount?: number;
  table5ViewableCount?: number;
  table6ViewableCount?: number;
  /** Before 2.24.01: one row per library, `[name, id, files, transcodes, sizeDiff, healthChecks, ...]`. */
  pies?: unknown[][];
}

interface RawLibrary {
  _id?: string;
  name?: string;
  folder?: string;
}

interface RawPie {
  pieStats?: {
    totalFiles?: number;
    totalTranscodeCount?: number;
    sizeDiff?: number;
    totalHealthCheckCount?: number;
  };
}

interface RawFile {
  _id?: string;
  file?: string;
  file_size?: number;
  TranscodeDecisionMaker?: string;
  HealthCheck?: string;
  lastTranscodeDate?: number;
  lastHealthCheckDate?: number;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const count = (v: unknown) => Math.max(0, Math.round(num(v) ?? 0));
const iso = (ms: unknown) => {
  const n = num(ms);
  return n !== null && n > 0 ? new Date(n).toISOString() : null;
};

/** `2.24.01` → [2, 24, 1]. */
export function parseTdarrVersion(version: string | null | undefined): number[] {
  return (version ?? '').split('.').map((p) => Number(p) || 0);
}

export function versionAtLeast(version: string | null | undefined, min: readonly number[]): boolean {
  const v = parseTdarrVersion(version);
  for (let i = 0; i < min.length; i++) {
    const a = v[i] ?? 0;
    const b = min[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

function worker(id: string, w: RawWorker): TranscodeWorker {
  const type = (w.workerType ?? '').toLowerCase();
  const progress = num(w.percentage);
  const original = num(w.originalfileSizeInGbytes);
  const estimated = num(w.estSize);
  return {
    id: w._id ?? id,
    kind: type.startsWith('healthcheck') ? 'healthCheck' : 'transcode',
    gpu: type.endsWith('gpu'),
    file: typeof w.file === 'string' && w.file ? w.file : null,
    progress: progress === null ? 0 : Math.max(0, Math.min(1, progress / 100)),
    fps: num(w.fps),
    eta: typeof w.ETA === 'string' && w.ETA ? w.ETA : null,
    step: typeof w.status === 'string' && w.status ? w.status : null,
    startedAt: iso(w.job?.start),
    originalBytes: original === null ? null : Math.round(original * GB),
    estimatedBytes: estimated === null || estimated <= 0 ? null : Math.round(estimated * GB),
  };
}

export function normalizeNodes(raw: Record<string, RawNode> | RawNode[]): TranscodeNode[] {
  const entries = Array.isArray(raw)
    ? raw.map((n, i) => [n._id ?? String(i), n] as const)
    : Object.entries(raw);
  return entries
    .filter(([, n]) => n && typeof n === 'object')
    .map(([key, n]): TranscodeNode => {
      const l = n.workerLimits ?? {};
      const limits: TranscodeWorkerLimits = {
        transcodeCpu: count(l.transcodecpu),
        transcodeGpu: count(l.transcodegpu),
        healthCheckCpu: count(l.healthcheckcpu),
        healthCheckGpu: count(l.healthcheckgpu),
      };
      const os = n.resStats?.os ?? {};
      const used = num(os.memUsedGB);
      const total = num(os.memTotalGB);
      return {
        id: n._id ?? key,
        name: n.nodeName || n._id || key,
        paused: n.nodePaused === true,
        workers: Object.entries(n.workers ?? {})
          .filter(([, w]) => w && typeof w === 'object' && w.idle !== true)
          .map(([id, w]) => worker(id, w)),
        limits,
        cpuPercent: num(os.cpuPerc),
        memoryUsedBytes: used === null ? null : Math.round(used * GB),
        memoryTotalBytes: total === null ? null : Math.round(total * GB),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function normalizeTotals(s: RawStatistics): TranscodeTotals {
  // The viewable counts leave out disabled libraries, like the Tdarr UI does.
  const table = (n: 1 | 2 | 3 | 4 | 5 | 6) => count(s[`table${n}ViewableCount`] ?? s[`table${n}Count`]);
  return {
    files: count(s.totalFileCount),
    transcodes: count(s.totalTranscodeCount),
    healthChecks: count(s.totalHealthCheckCount),
    savedBytes: Math.round((num(s.sizeDiff) ?? 0) * GB),
    queued: { transcode: table(1), healthCheck: table(4) },
    done: { transcode: table(2), healthCheck: table(5) },
    failed: { transcode: table(3), healthCheck: table(6) },
  };
}

function failure(f: RawFile, kind: TranscodeFailure['kind']): TranscodeFailure | null {
  const file = f.file ?? f._id;
  if (typeof file !== 'string' || !file) return null;
  const status = (kind === 'transcode' ? f.TranscodeDecisionMaker : f.HealthCheck) ?? '';
  const size = num(f.file_size);
  return {
    file,
    kind,
    outcome: /cancel/i.test(status) ? 'cancelled' : 'error',
    at: iso(kind === 'transcode' ? f.lastTranscodeDate : f.lastHealthCheckDate),
    // `file_size` is in megabytes.
    sizeBytes: size === null ? null : Math.round(size * 1024 * 1024),
  };
}

const credentials = z.object({
  // Only needed when authentication is switched on in Tdarr.
  apiKey: z.string().trim().max(256).optional().default(''),
});

type Credentials = z.infer<typeof credentials>;

export const tdarr = defineAdapter({
  id: 'tdarr',
  name: 'Tdarr',
  category: 'transcoder',
  lifecycle: 'active',
  homepage: 'https://tdarr.io',
  fields: [
    {
      key: 'apiKey',
      kind: 'secret',
      label: 'adapters.fields.apiKey',
      help: 'adapters.help.apiKeyTdarr',
      required: false,
    },
  ],
  credentials,
  capabilities: ['health', 'transcoding'],
  create(ctx: AdapterContext<Credentials>) {
    const headers: Record<string, string> = ctx.credentials.apiKey
      ? { 'x-api-key': ctx.credentials.apiKey }
      : {};
    const instance = { id: ctx.instanceId, name: ctx.instanceName, adapter: 'tdarr' };

    const get = async <T>(path: string) => jsonOf<T>(await ctx.http.request({ path, headers }));
    const post = async <T>(path: string, data: unknown) =>
      jsonOf<T>(await ctx.http.request({ method: 'POST', path, headers, json: { data } }));
    const crud = <T>(collection: string, mode: 'getById' | 'getAll', docID = '') =>
      post<T>('/api/v2/cruddb', { collection, mode, docID, obj: {} });

    const status = async (): Promise<StatusResponse> => {
      const res = await ctx.http.request({ path: '/api/v2/status', headers });
      if (res.status === 401 || res.status === 403)
        throw new AdapterError('unauthorized', `HTTP ${res.status}`, res.status);
      // Tdarr 1 had no v2 API.
      if (res.status === 404) throw new AdapterError('unsupported', 'Tdarr API v2 not offered', 404);
      let body: StatusResponse;
      try {
        body = jsonOf<StatusResponse>(res);
      } catch (err) {
        if (err instanceof AdapterError) throw err;
        throw new AdapterError('badResponse', 'not a Tdarr API');
      }
      if (!body || typeof body.version !== 'string') throw new AdapterError('badResponse', 'not a Tdarr API');
      return body;
    };

    const detection = detectionCache(async (): Promise<ApiDetection> => {
      const s = await status();
      const major = majorOf(s.version);
      const untested = major < TESTED_MAJORS.min || major > TESTED_MAJORS.max;
      return {
        api: 'v2',
        apiBase: '/api/v2',
        productVersion: s.version ?? null,
        productName: 'Tdarr',
        offered: ['v2'],
        compat: untested ? { reason: 'untestedVersion', newestOffered: null } : null,
      };
    });

    const nodes = async () => normalizeNodes(await get<Record<string, RawNode>>('/api/v2/get-nodes'));
    const statistics = () => crud<RawStatistics>('StatisticsJSONDB', 'getById', 'statistics');
    const libraries = async () => {
      const list = await crud<RawLibrary[]>('LibrarySettingsJSONDB', 'getAll');
      return (Array.isArray(list) ? list : []).filter((l) => typeof l?._id === 'string');
    };

    /** Rows of one of Tdarr's status tables, newest first as Tdarr sorts them. */
    const table = async (name: 'table3' | 'table6', limit: number) => {
      const res = await post<{ array?: RawFile[] }>('/api/v2/client/status-tables', {
        start: 0,
        pageSize: limit,
        filters: [],
        sorts: [],
        opts: { table: name },
      });
      return Array.isArray(res.array) ? res.array : [];
    };

    return {
      async testConnection() {
        detection.reset();
        const d = await detection.get();
        // The status may answer without a key, so a protected endpoint checks it.
        await nodes();
        return {
          version: d.productVersion,
          product: 'Tdarr',
          apiVersion: d.api,
          ...(d.compat ? { compatibility: d.compat.reason } : {}),
        };
      },
      async health() {
        const d = await detection.get();
        const signals: Signal[] = [];
        const compat = compatSignal(d, instance, 'Tdarr');
        if (compat) signals.push(compat);
        return signals;
      },
      async transcoding() {
        const [s, list, stats] = await Promise.all([
          status(),
          nodes(),
          part(() => statistics(), null as RawStatistics | null),
        ]);
        // A Tdarr update is noticed here and detected again on the next call.
        await detection.noteVersion(s.version);
        return { nodes: list, totals: stats ? normalizeTotals(stats) : null };
      },
      async transcodeLibraries() {
        const d = await detection.get();
        const libs = await libraries();
        const base = (l: RawLibrary): TranscodeLibrary => ({
          id: l._id!,
          name: l.name || l._id!,
          folder: typeof l.folder === 'string' && l.folder ? l.folder : null,
          files: null,
          transcodes: null,
          healthChecks: null,
          savedBytes: null,
        });
        if (versionAtLeast(d.productVersion, PIES_ENDPOINT_FROM)) {
          return Promise.all(
            libs.map(async (l) => {
              const pie = await part(
                () => post<RawPie>('/api/v2/stats/get-pies', { libraryId: l._id }),
                null as RawPie | null,
              );
              const p = pie?.pieStats;
              const saved = num(p?.sizeDiff);
              return {
                ...base(l),
                files: num(p?.totalFiles),
                transcodes: num(p?.totalTranscodeCount),
                healthChecks: num(p?.totalHealthCheckCount),
                savedBytes: saved === null ? null : Math.round(saved * GB),
              };
            }),
          );
        }
        // Older versions keep the per-library numbers in the statistics document.
        const stats = await part(() => statistics(), {} as RawStatistics);
        const rows = new Map(
          (Array.isArray(stats.pies) ? stats.pies : [])
            .filter((r): r is unknown[] => Array.isArray(r) && typeof r[1] === 'string')
            .map((r) => [r[1] as string, r]),
        );
        return libs.map((l) => {
          const r = rows.get(l._id!);
          const saved = num(r?.[4]);
          return {
            ...base(l),
            files: num(r?.[2]),
            transcodes: num(r?.[3]),
            healthChecks: num(r?.[5]),
            savedBytes: saved === null ? null : Math.round(saved * GB),
          };
        });
      },
      async transcodeFailures(limit) {
        const [transcodes, checks] = await Promise.all([table('table3', limit), table('table6', limit)]);
        return [
          ...transcodes.map((f) => failure(f, 'transcode')),
          ...checks.map((f) => failure(f, 'healthCheck')),
        ]
          .filter((f): f is TranscodeFailure => f !== null)
          .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
          .slice(0, limit);
      },
      async topology() {
        // Tdarr reads the library folders; it reports no disk space.
        const libs = await part(() => libraries(), [] as RawLibrary[]);
        const folders: StorageFolder[] = libs
          .filter((l) => typeof l.folder === 'string' && l.folder)
          .map((l) => folder(l.folder!, 'library', {}, { name: l.name, kind: 'other' }));
        return { links: [], folders };
      },
      webUrl() {
        return `${ctx.baseUrl}/`;
      },
    };
  },
});
