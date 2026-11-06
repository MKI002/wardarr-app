// Builds the Fastify application. Used by main.ts and by tests.
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { authGuard, type RegisteredRoute } from './auth/guard.js';
import { LoginLockout } from './auth/lockout.js';
import { CleanerService } from './cleaner/service.js';
import { registerCleanerRoutes } from './cleaner/routes.js';
import { FeatureStore } from './features/store.js';
import { HuntingService } from './hunting/service.js';
import { registerHuntingRoutes } from './hunting/routes.js';
import { registerImageRoutes, type ImageFetch } from './images/tmdb.js';
import { registerIndexerRoutes } from './indexers/routes.js';
import { IndexerService } from './indexers/service.js';
import { registerLibraryRoutes } from './library/routes.js';
import { LibraryService } from './library/service.js';
import { registerRequestRoutes } from './requests/routes.js';
import { RequestService } from './requests/service.js';
import { StreamHistoryService } from './streams/history.js';
import { registerAuthRoutes, type CookieOptions } from './auth/routes.js';
import { SessionStore } from './auth/sessions.js';
import { registerSetupRoutes } from './auth/setup.js';
import './auth/types.js';
import type { Db } from './db/index.js';
import { EventBus } from './events/bus.js';
import { registerEventRoutes } from './events/routes.js';
import { HttpError } from './http/validate.js';
import { AdapterRegistry } from './instances/registry.js';
import { InstanceRuntime } from './instances/runtime.js';
import { registerInstanceRoutes } from './instances/routes.js';
import { InstanceStore } from './instances/store.js';
import { registerIssueRoutes } from './issues/routes.js';
import { IssueService } from './issues/service.js';
import { registerOverviewRoutes } from './overview/routes.js';
import type { SecretBox } from './security/crypto.js';
import { redact, redactString } from './security/redact.js';
import { registerUserRoutes } from './users/routes.js';
import { UserStore } from './users/store.js';

export interface AppOptions {
  db: Db;
  box: SecretBox;
  registry?: AdapterRegistry;
  trustProxy?: boolean;
  cookieSecure?: boolean | 'auto';
  logLevel?: string;
  webDir?: string;
  httpTimeoutMs?: number;
  /** Replaces the poster download, for tests. */
  imageFetch?: ImageFetch;
}

export interface App {
  app: FastifyInstance;
  routes: RegisteredRoute[];
  runtime: InstanceRuntime;
  issues: IssueService;
  users: UserStore;
  sessions: SessionStore;
  store: InstanceStore;
  bus: EventBus;
  cleaner: CleanerService;
  hunting: HuntingService;
  library: LibraryService;
  history: StreamHistoryService;
  requests: RequestService;
  indexers: IndexerService;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function loggerOptions(level: string): FastifyServerOptions['logger'] {
  return {
    level,
    // No host name or pid in logs.
    base: undefined,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
      ],
      censor: '[redacted]',
    },
    formatters: {
      // Pino runs this before the serializers, so request and response
      // objects are passed through untouched and masked by their serializers.
      log: (obj) => {
        const { req, res, ...rest } = obj;
        return {
          ...(redact(rest) as Record<string, unknown>),
          ...(req === undefined ? {} : { req }),
          ...(res === undefined ? {} : { res }),
        };
      },
    },
    serializers: {
      req: (req: { method?: string; url?: string }) => ({
        method: req.method,
        url: redactString(req.url ?? ''),
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
  };
}

export async function buildApp(opts: AppOptions): Promise<App> {
  const app = Fastify({
    logger: loggerOptions(opts.logLevel ?? 'info'),
    trustProxy: opts.trustProxy ?? false,
    bodyLimit: 1024 * 1024,
  });

  const routes: RegisteredRoute[] = [];
  const registry = opts.registry ?? new AdapterRegistry();
  const bus = new EventBus();
  const users = new UserStore(opts.db);
  const sessions = new SessionStore(opts.db);
  const lockout = new LoginLockout();
  const store = new InstanceStore(opts.db, opts.box, registry);
  // The rule context resolves the runtime lazily; it is created right after.
  const runtimeRef: { current: InstanceRuntime | null } = { current: null };
  const issues = new IssueService(opts.db, bus, () => ({
    webUrl: (instanceId, target) => runtimeRef.current?.adapter(instanceId)?.adapter.webUrl?.(target),
    findIndexer: (name) => {
      const wanted = name.trim().toLowerCase();
      for (const { row, snapshot } of runtimeRef.current?.snapshots() ?? []) {
        const hit = snapshot.indexers?.find((i) => i.name.trim().toLowerCase() === wanted);
        if (hit) return { instanceId: row.id, indexerId: hit.id };
      }
      return undefined;
    },
  }));
  const runtime = new InstanceRuntime(store, issues, bus, app.log, opts.httpTimeoutMs ?? 10_000);
  runtimeRef.current = runtime;
  const features = new FeatureStore(opts.db);
  const cleaner = new CleanerService(opts.db, features, runtime, bus, app.log);
  const hunting = new HuntingService(opts.db, features, runtime, cleaner, bus);
  const history = new StreamHistoryService(opts.db, runtime);
  const library = new LibraryService(features, runtime, bus, app.log);
  const requests = new RequestService(opts.db, runtime, users, bus);
  const indexers = new IndexerService(runtime);
  const cookie: CookieOptions = { secure: opts.cookieSecure ?? 'auto' };

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
    hsts: { maxAge: 31536000, includeSubDomains: false },
  });
  await app.register(fastifyRateLimit, { global: false });
  await app.register(authGuard, { sessions, routes });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, details: err.details });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: status === 429 ? 'tooManyRequests' : 'badRequest' });
    }
    req.log.error({ err }, 'request failed');
    return reply.code(500).send({ error: 'internal' });
  });

  // Health check without any details about the installation.
  app.get('/healthz', { config: { access: 'public' } }, async () => ({ status: 'ok' }));

  registerSetupRoutes(app, { users, sessions, cookie });
  registerAuthRoutes(app, { users, sessions, lockout, cookie });
  registerUserRoutes(app, { users, sessions });
  registerInstanceRoutes(app, { registry, store, runtime });
  registerIssueRoutes(app, { issues, runtime });
  registerOverviewRoutes(app, { runtime, issues });
  registerEventRoutes(app, { bus });
  registerCleanerRoutes(app, { cleaner });
  registerHuntingRoutes(app, { hunting });
  registerRequestRoutes(app, { requests });
  registerLibraryRoutes(app, { library, history });
  registerIndexerRoutes(app, { indexers });
  registerImageRoutes(app, { fetch: opts.imageFetch });

  // The web UI bundle contains no data, so it is served without login.
  // Unknown API paths answer 401 to anonymous callers, 404 otherwise.
  const webDir =
    opts.webDir && existsSync(path.join(opts.webDir, 'index.html')) ? path.resolve(opts.webDir) : null;
  if (webDir) {
    await app.register(fastifyStatic, { root: webDir, serve: false });
  }
  app.get('/*', { config: { access: 'public' } }, async (req, reply) => {
    const url = req.url.split('?')[0] ?? '/';
    if (url === '/api' || url.startsWith('/api/')) {
      return reply.code(req.user ? 404 : 401).send({ error: req.user ? 'notFound' : 'unauthenticated' });
    }
    if (!webDir) return reply.code(404).send({ error: 'notFound' });
    let rel: string;
    try {
      rel = path.posix.normalize(decodeURIComponent(url));
    } catch {
      return reply.code(400).send({ error: 'badRequest' });
    }
    const file = path.resolve(webDir, `.${rel}`);
    if (rel !== '/' && file.startsWith(webDir + path.sep) && isFile(file) && !file.endsWith('.map')) {
      const immutable = rel.startsWith('/assets/');
      reply.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      return reply.sendFile(path.relative(webDir, file));
    }
    reply.header('cache-control', 'no-cache');
    return reply.sendFile('index.html');
  });

  return {
    app,
    routes,
    runtime,
    issues,
    users,
    sessions,
    store,
    bus,
    cleaner,
    hunting,
    library,
    history,
    requests,
    indexers,
  };
}
