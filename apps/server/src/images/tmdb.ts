// Poster proxy. Browsers load posters from Wardarr, so TMDB and TheTVDB
// never see who is looking. The upstream hosts are fixed; paths are strictly
// validated.
import type { FastifyInstance, FastifyReply } from 'fastify';
import { HttpError } from '../http/validate.js';

const UPSTREAM = 'https://image.tmdb.org/t/p';
const SIZES = new Set(['w92', 'w185', 'w342', 'w500', 'w780', 'w1280']);
const FILE = /^[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$/;
// Sonarr's artwork comes from TheTVDB: `banners/v4/series/123/posters/abc.jpg`.
const TVDB_UPSTREAM = 'https://artworks.thetvdb.com';
const TVDB_PATH = /^banners\/(?:[A-Za-z0-9_-]{1,64}\/){1,6}[A-Za-z0-9_-]{1,96}\.(?:jpg|jpeg|png|webp)$/;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ENTRIES = 400;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 8000;

interface Cached {
  type: string;
  body: Buffer;
}

export class ImageCache {
  private readonly entries = new Map<string, Cached>();
  private bytes = 0;

  get(key: string): Cached | undefined {
    const hit = this.entries.get(key);
    if (hit) {
      // Refresh the position, so the cache drops the least recently used.
      this.entries.delete(key);
      this.entries.set(key, hit);
    }
    return hit;
  }

  set(key: string, value: Cached): void {
    this.entries.set(key, value);
    this.bytes += value.body.length;
    while (this.entries.size > MAX_ENTRIES || this.bytes > MAX_CACHE_BYTES) {
      const [oldest, v] = this.entries.entries().next().value as [string, Cached];
      this.entries.delete(oldest);
      this.bytes -= v.body.length;
    }
  }
}

export type ImageFetch = (url: string, signal: AbortSignal) => Promise<Response>;

export function registerImageRoutes(
  app: FastifyInstance,
  deps: { fetch?: ImageFetch; cache?: ImageCache } = {},
): void {
  const cache = deps.cache ?? new ImageCache();
  const doFetch: ImageFetch = deps.fetch ?? ((url, signal) => fetch(url, { signal, redirect: 'error' }));

  async function serve(key: string, url: string, reply: FastifyReply) {
    let hit = cache.get(key);
    if (!hit) {
      let res: Response;
      try {
        res = await doFetch(url, AbortSignal.timeout(TIMEOUT_MS));
      } catch {
        throw new HttpError(502, 'serviceError', { kind: 'unreachable' });
      }
      const type = res.headers.get('content-type') ?? '';
      if (!res.ok || !/^image\/(jpeg|png|webp)$/.test(type)) throw new HttpError(404, 'notFound');
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > MAX_BYTES) throw new HttpError(404, 'notFound');
      hit = { type, body };
      cache.set(key, hit);
    }
    reply.header('content-type', hit.type);
    reply.header('cache-control', 'private, max-age=604800, immutable');
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(hit.body);
  }

  app.get<{ Params: { size: string; file: string } }>(
    '/api/images/tmdb/:size/:file',
    { config: { access: 'user' } },
    async (req, reply) => {
      const { size, file } = req.params;
      if (!SIZES.has(size) || !FILE.test(file)) throw new HttpError(404, 'notFound');
      const key = `${size}/${file}`;
      return serve(key, `${UPSTREAM}/${key}`, reply);
    },
  );

  app.get<{ Params: { '*': string } }>(
    '/api/images/tvdb/*',
    { config: { access: 'user' } },
    async (req, reply) => {
      const path = req.params['*'];
      if (!TVDB_PATH.test(path)) throw new HttpError(404, 'notFound');
      return serve(`tvdb/${path}`, `${TVDB_UPSTREAM}/${path}`, reply);
    },
  );
}
