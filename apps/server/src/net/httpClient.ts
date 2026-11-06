// HTTP client used by adapters: timeouts on every call, SSRF checks on every
// connection, redirects followed manually without credentials, and a cap on
// response size.
import {
  AdapterError,
  buildQuery,
  type HttpClient,
  type HttpRequest,
  type HttpResponse,
} from '@wardarr/core';
import { Agent, request as undiciRequest, type Dispatcher } from 'undici';
import { checkUrl, guardedLookup } from './ssrf.js';

const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 32 * 1024 * 1024;

/** Header and query names that carry credentials. Stripped on redirects. */
const CREDENTIAL_HEADERS = [
  'authorization',
  'cookie',
  'x-api-key',
  'x-plex-token',
  'x-emby-token',
  'x-mediabrowser-token',
  'x-api-user',
  'x-transmission-session-id',
];
const CREDENTIAL_QUERY = [
  'apikey',
  'api_key',
  'x-plex-token',
  'token',
  'password',
  'pass',
  'ma_password',
  'ma_username',
];

let sharedAgent: Agent | undefined;
function agent(): Agent {
  sharedAgent ??= new Agent({
    connect: { lookup: guardedLookup as never, timeout: 10_000 },
    keepAliveTimeout: 10_000,
    connections: 16,
  });
  return sharedAgent;
}

export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs: number;
  /** Accept self-signed certificates. Off by default. */
  allowInsecureTls?: boolean;
  dispatcher?: Dispatcher;
  /** Off for URLs that carry a secret in the path, such as webhooks. */
  followRedirects?: boolean;
}

function stripCredentials(url: URL, headers: Record<string, string>): Record<string, string> {
  for (const name of [...url.searchParams.keys()]) {
    if (CREDENTIAL_QUERY.includes(name.toLowerCase())) url.searchParams.delete(name);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!CREDENTIAL_HEADERS.includes(k.toLowerCase())) out[k] = v;
  }
  return out;
}

function classify(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const e = err as { name?: string; code?: string; message?: string };
  if (
    e?.name === 'TimeoutError' ||
    e?.name === 'AbortError' ||
    e?.code === 'UND_ERR_CONNECT_TIMEOUT' ||
    e?.code === 'UND_ERR_HEADERS_TIMEOUT' ||
    e?.code === 'UND_ERR_BODY_TIMEOUT'
  ) {
    return new AdapterError('timeout', 'request timed out');
  }
  if (
    e?.code === 'EWARDARR_BLOCKED' ||
    (e as { cause?: { code?: string } })?.cause?.code === 'EWARDARR_BLOCKED'
  ) {
    return new AdapterError('blocked', 'address is not allowed');
  }
  return new AdapterError('unreachable', e?.code ?? 'connection failed');
}

export function createHttpClient(opts: HttpClientOptions): HttpClient {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const dispatcher =
    opts.dispatcher ??
    (opts.allowInsecureTls
      ? new Agent({ connect: { lookup: guardedLookup as never, rejectUnauthorized: false, timeout: 10_000 } })
      : agent());

  return {
    async request(req: HttpRequest): Promise<HttpResponse> {
      let url = new URL(base + req.path + buildQuery(req.query));
      let headers: Record<string, string> = { accept: 'application/json', ...req.headers };
      let body: string | undefined;
      if (req.json !== undefined) {
        body = JSON.stringify(req.json);
        headers['content-type'] = 'application/json';
      } else if (req.form) {
        body = new URLSearchParams(req.form).toString();
        headers['content-type'] = 'application/x-www-form-urlencoded';
      }
      let method = req.method ?? 'GET';
      const signal = AbortSignal.timeout(req.timeoutMs ?? opts.timeoutMs);

      for (let hop = 0; ; hop++) {
        const check = checkUrl(url.toString());
        if (!check.ok) throw new AdapterError('blocked', `url rejected: ${check.reason}`);
        let res: Dispatcher.ResponseData;
        try {
          res = await undiciRequest(url, { method, headers, body, signal, dispatcher });
        } catch (err) {
          throw classify(err);
        }
        if (
          opts.followRedirects !== false &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          await res.body.dump();
          if (hop >= MAX_REDIRECTS) throw new AdapterError('badResponse', 'too many redirects');
          const next = new URL(String(res.headers.location), url);
          headers = stripCredentials(next, headers);
          if (
            res.statusCode === 303 ||
            ((res.statusCode === 301 || res.statusCode === 302) && method === 'POST')
          ) {
            method = 'GET';
            body = undefined;
            delete headers['content-type'];
          }
          url = next;
          continue;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        try {
          for await (const chunk of res.body) {
            size += (chunk as Buffer).length;
            if (size > MAX_BODY_BYTES) {
              res.body.destroy();
              throw new AdapterError('badResponse', 'response too large');
            }
            chunks.push(chunk as Buffer);
          }
        } catch (err) {
          throw classify(err);
        }
        const text = Buffer.concat(chunks).toString('utf8');
        const outHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined) outHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        return {
          status: res.statusCode,
          headers: outHeaders,
          text,
          json<T>() {
            try {
              return JSON.parse(text) as T;
            } catch {
              throw new AdapterError('badResponse', 'invalid JSON');
            }
          },
        };
      }
    },
  };
}
