// Builds the Fastify application. Used by main.ts and by tests.
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { authGuard, type RegisteredRoute } from './auth/guard.js';
import { registerBackupRoutes } from './backups/routes.js';
import type { BackupService } from './backups/service.js';
import { LoginLockout } from './auth/lockout.js';
import { registerCalendarRoutes } from './calendar/routes.js';
import { CalendarService } from './calendar/service.js';
import { CleanerService } from './cleaner/service.js';
import { registerCleanerRoutes } from './cleaner/routes.js';
import { FeatureStore } from './features/store.js';
import { HuntingService } from './hunting/service.js';
import { registerHuntingRoutes } from './hunting/routes.js';
import { registerImageRoutes, type ImageFetch } from './images/tmdb.js';
import { registerIndexerRoutes } from './indexers/routes.js';
import { IndexerService } from './indexers/service.js';
import { registerIndexerInsightRoutes } from './indexers/insightsRoutes.js';
import { PriorityWatchdog } from './indexers/insights/priorities.js';
import { IndexerInsightsService } from './indexers/insights/service.js';
import { registerLibraryRoutes } from './library/routes.js';
import { registerNotificationRoutes } from './notifications/routes.js';
import { NotificationService, type NotificationOptions } from './notifications/service.js';
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
import { TrendSampler, registerTrendRoutes } from './overview/trend.js';
import { registerQualityRoutes } from './quality/routes.js';
import { QualityService } from './quality/service.js';
import { registerStorageRoutes } from './storage/routes.js';
import { StorageService } from './storage/service.js';
import { registerTrashRoutes } from './trash/routes.js';
import { TrashService } from './trash/service.js';
import type { GuideSource } from './trash/source.js';
import type { SecretBox } from './security/crypto.js';
import { redact, redactString } from './security/redact.js';
import { registerTopologyRoutes } from './topology/routes.js';
import { registerTranscodingRoutes } from './transcoding/routes.js';
import { TranscodingService } from './transcoding/service.js';
import { TopologyService } from './topology/service.js';
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
  /** Address of this installation, for links in notifications. */
  publicUrl?: string;
  /** Overrides for notification timing and delivery, for tests. */
  notificationOptions?: NotificationOptions;
  /** Local checkout of the TRaSH Guides. */
  trashDir?: string;
  /** Replaces the TRaSH Guides download, for tests. */
  trashSource?: GuideSource;
  /** Backups of Wardarr's own data; the routes exist only when it is set. */
  backups?: BackupService;
  /** Restarts the server in place, after a restore was staged. */
  restart?: () => void;
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
  topology: TopologyService;
  indexerInsights: IndexerInsightsService;
  indexerPriorities: PriorityWatchdog;
  notifications: NotificationService;
  trash: TrashService;
  calendar: CalendarService;
  storage: StorageService;
  transcoding: TranscodingService;
  quality: QualityService;
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
    // Server-sent event streams must not hold up a shutdown or a restart.
    forceCloseConnections: true,
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
  const indexers = new IndexerService(runtime, { features, bus });
  const quality = new QualityService(runtime, { features, bus });
  const trend = new TrendSampler(runtime);
  const topology = new TopologyService(runtime);
  const transcoding = new TranscodingService(opts.db, runtime);
  const indexerInsights = new IndexerInsightsService(opts.db, features, runtime, bus, app.log);
  const indexerPriorities = new PriorityWatchdog(opts.db, runtime, indexerInsights, bus, app.log);
  const notifications = new NotificationService(opts.db, opts.box, issues, app.log, {
    publicUrl: opts.publicUrl,
    ...opts.notificationOptions,
  });
  const storage = new StorageService(opts.db, runtime, bus, app.log);
  const trash = new TrashService(opts.db, runtime, bus, app.log, {
    source: opts.trashSource,
    localDir: opts.trashDir,
  });
  const calendar = new CalendarService(opts.db, runtime);
  requests.onCreated(
    (req, user) => void notifications.requestPending(req, user.displayName ?? user.username),
  );
  app.addHook('onClose', async () => notifications.stop());
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
  registerOverviewRoutes(app, { runtime, issues, storage });
  registerTrendRoutes(app, { trend });
  registerEventRoutes(app, { bus });
  registerCleanerRoutes(app, { cleaner });
  registerHuntingRoutes(app, { hunting });
  registerRequestRoutes(app, { requests });
  registerLibraryRoutes(app, { library, history });
  registerIndexerRoutes(app, { indexers });
  registerTopologyRoutes(app, { topology });
  registerIndexerInsightRoutes(app, { insights: indexerInsights, priorities: indexerPriorities });
  registerNotificationRoutes(app, { notifications });
  registerTrashRoutes(app, { trash });
  if (opts.backups) {
    opts.backups.onChange(() => bus.publish({ type: 'backups.updated', audience: 'admin' }));
    registerBackupRoutes(app, { backups: opts.backups, restart: opts.restart });
  }
  registerCalendarRoutes(app, { calendar, publicUrl: opts.publicUrl });
  registerStorageRoutes(app, { storage });
  registerQualityRoutes(app, { quality });
  registerTranscodingRoutes(app, { transcoding });
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
    topology,
    indexerInsights,
    indexerPriorities,
    notifications,
    trash,
    calendar,
    storage,
    transcoding,
    quality,
  };
}
