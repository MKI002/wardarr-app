// Discover and requests through Seerr. Every request is made as the Seerr
// user that belongs to the Wardarr user, so Seerr's own permissions, quotas
// and auto-approval apply unchanged.
import {
  AdapterError,
  type AdapterInstance,
  type ExternalUser,
  type MediaRequest,
  type NewRequest,
  type RequestEdit,
  type RequestFilter,
  type RequestServer,
} from '@wardarr/core';
import { and, eq } from 'drizzle-orm';
import type { AuthUser } from '../auth/types.js';
import type { Db } from '../db/index.js';
import { requestLinks } from '../db/schema.js';
import type { EventBus } from '../events/bus.js';
import { HttpError } from '../http/validate.js';
import type { InstanceRuntime } from '../instances/runtime.js';
import type { UserStore } from '../users/store.js';

const USERS_TTL_MS = 10 * 60_000;
const SERVERS_TTL_MS = 5 * 60_000;

export type LinkSource = 'manual' | 'auto' | 'none';

export interface Link {
  externalId: number | null;
  externalName: string | null;
  source: LinkSource;
}

function kindOf(err: unknown): string {
  return err instanceof AdapterError ? err.kind : 'badResponse';
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export class RequestService {
  private readonly usersCache = new Map<string, { at: number; users: ExternalUser[] }>();
  private readonly serversCache = new Map<string, { at: number; servers: RequestServer[] }>();

  constructor(
    private readonly db: Db,
    private readonly runtime: InstanceRuntime,
    private readonly users: UserStore,
    private readonly bus: EventBus,
    private readonly now: () => number = () => Date.now(),
  ) {
    runtime.onReload(() => {
      this.usersCache.clear();
      this.serversCache.clear();
    });
  }

  private readonly createdListeners: Array<(req: MediaRequest, user: AuthUser) => void> = [];

  /** Called after a request was created, for notifications. */
  onCreated(listener: (req: MediaRequest, user: AuthUser) => void): void {
    this.createdListeners.push(listener);
  }

  /** Enabled request managers (Seerr) in a stable order. */
  instances() {
    return this.runtime
      .snapshots()
      .filter(({ row, def }) => row.enabled && def.capabilities.includes('requests'))
      .sort((a, b) => a.row.name.localeCompare(b.row.name))
      .map(({ row, def }) => ({ id: row.id, name: row.name, adapter: def.id }));
  }

  /** The adapter of the given or the first request manager. */
  private pick(instanceId?: string): {
    id: string;
    adapter: AdapterInstance;
    run: <T>(fn: () => Promise<T>) => Promise<T>;
  } {
    const list = this.instances();
    const chosen = instanceId ? list.find((i) => i.id === instanceId) : list[0];
    const entry = chosen && this.runtime.adapter(chosen.id);
    if (!chosen || !entry) throw new HttpError(404, 'notFound');
    return {
      id: chosen.id,
      adapter: entry.adapter,
      run: async (fn) => {
        try {
          return await entry.gate.run(fn);
        } catch (err) {
          if (err instanceof HttpError) throw err;
          throw new HttpError(502, 'serviceError', { kind: kindOf(err) });
        }
      },
    };
  }

  private method<K extends keyof AdapterInstance>(
    adapter: AdapterInstance,
    name: K,
  ): NonNullable<AdapterInstance[K]> {
    const fn = adapter[name];
    if (!fn) throw new HttpError(400, 'unsupported');
    return (fn as (...a: unknown[]) => unknown).bind(adapter) as NonNullable<AdapterInstance[K]>;
  }

  async externalUsers(instanceId: string): Promise<ExternalUser[]> {
    const cached = this.usersCache.get(instanceId);
    if (cached && this.now() - cached.at < USERS_TTL_MS) return cached.users;
    const s = this.pick(instanceId);
    const users = await s.run(() => this.method(s.adapter, 'users')());
    this.usersCache.set(instanceId, { at: this.now(), users });
    return users;
  }

  /**
   * The Seerr user a Wardarr user acts as: a mapping set by an admin, or else
   * the only Seerr user whose name matches the Wardarr user name.
   */
  async linkFor(user: Pick<AuthUser, 'id' | 'username' | 'displayName'>, instanceId: string): Promise<Link> {
    const stored = this.db
      .select()
      .from(requestLinks)
      .where(and(eq(requestLinks.userId, user.id), eq(requestLinks.instanceId, instanceId)))
      .get();
    if (stored) return { externalId: stored.externalId, externalName: stored.externalName, source: 'manual' };
    let external: ExternalUser[];
    try {
      external = await this.externalUsers(instanceId);
    } catch {
      return { externalId: null, externalName: null, source: 'none' };
    }
    const names = new Set([user.username, user.displayName].filter((n): n is string => !!n).map(norm));
    const hits = external.filter((e) => e.aliases.some((a) => names.has(norm(a))) || names.has(norm(e.name)));
    if (hits.length === 1) return { externalId: hits[0]!.id, externalName: hits[0]!.name, source: 'auto' };
    return { externalId: null, externalName: null, source: 'none' };
  }

  /** The Seerr user id to act as. Admins without a link act as the API key owner. */
  private async actAs(user: AuthUser, instanceId: string): Promise<number | undefined> {
    const link = await this.linkFor(user, instanceId);
    if (link.externalId !== null) return link.externalId;
    if (user.role === 'admin') return undefined;
    throw new HttpError(409, 'notLinked');
  }

  async setLink(userId: string, instanceId: string, externalId: number | null): Promise<void> {
    this.pick(instanceId);
    if (!this.users.list().some((u) => u.id === userId)) throw new HttpError(404, 'notFound');
    this.db
      .delete(requestLinks)
      .where(and(eq(requestLinks.userId, userId), eq(requestLinks.instanceId, instanceId)))
      .run();
    if (externalId === null) return;
    const external = (await this.externalUsers(instanceId)).find((e) => e.id === externalId);
    if (!external) throw new HttpError(404, 'notFound');
    this.db
      .insert(requestLinks)
      .values({ userId, instanceId, externalId, externalName: external.name })
      .run();
  }

  /** Every Wardarr user with the Seerr user they request as. */
  async links(instanceId?: string) {
    const s = this.pick(instanceId);
    let external: ExternalUser[] = [];
    let error: string | null = null;
    try {
      external = await this.externalUsers(s.id);
    } catch (err) {
      error =
        err instanceof HttpError
          ? String((err.details as { kind?: string })?.kind ?? err.code)
          : 'badResponse';
    }
    const users = await Promise.all(
      this.users
        .list()
        .filter((u) => !u.disabled)
        .map(async (u) => ({
          userId: u.id,
          username: u.username,
          displayName: u.displayName,
          role: u.role,
          link: await this.linkFor(u, s.id),
        })),
    );
    return {
      instanceId: s.id,
      error,
      users,
      external: external.map((e) => ({ id: e.id, name: e.name })),
    };
  }

  // Discover.

  async discover(user: AuthUser, list: 'trending' | 'movies' | 'tv', page: number, instanceId?: string) {
    const s = this.pick(instanceId);
    const asUser = await this.actAs(user, s.id).catch(() => undefined);
    return {
      instanceId: s.id,
      ...(await s.run(() => this.method(s.adapter, 'discover')(list, page, asUser))),
    };
  }

  async search(user: AuthUser, query: string, page: number, instanceId?: string) {
    const s = this.pick(instanceId);
    const asUser = await this.actAs(user, s.id).catch(() => undefined);
    return {
      instanceId: s.id,
      ...(await s.run(() => this.method(s.adapter, 'searchMedia')(query, page, asUser))),
    };
  }

  async details(user: AuthUser, mediaType: 'movie' | 'tv', tmdbId: number, instanceId?: string) {
    const s = this.pick(instanceId);
    const asUser = await this.actAs(user, s.id).catch(() => undefined);
    return s.run(() => this.method(s.adapter, 'mediaDetails')(mediaType, tmdbId, asUser));
  }

  async servers(instanceId?: string): Promise<RequestServer[]> {
    const s = this.pick(instanceId);
    const cached = this.serversCache.get(s.id);
    if (cached && this.now() - cached.at < SERVERS_TTL_MS) return cached.servers;
    const servers = await s.run(() => this.method(s.adapter, 'requestServers')());
    this.serversCache.set(s.id, { at: this.now(), servers });
    return servers;
  }

  /**
   * What the user can choose when requesting: standard or 4K, and which
   * server. Quality profiles and folders are for admins only.
   */
  async options(user: AuthUser, instanceId?: string) {
    const s = this.pick(instanceId);
    const [servers, link] = await Promise.all([this.servers(s.id), this.linkFor(user, s.id)]);
    const admin = user.role === 'admin';
    return {
      instanceId: s.id,
      linked: link.externalId !== null || admin,
      link: admin ? link : { externalId: null, externalName: link.externalName, source: link.source },
      servers: servers.map((srv) =>
        admin
          ? srv
          : { id: srv.id, name: srv.name, type: srv.type, is4k: srv.is4k, isDefault: srv.isDefault },
      ),
    };
  }

  async create(user: AuthUser, req: NewRequest, instanceId?: string): Promise<MediaRequest> {
    const s = this.pick(instanceId);
    const asUser = await this.actAs(user, s.id);
    const body: NewRequest =
      user.role === 'admin' ? req : { ...req, profileId: undefined, rootFolder: undefined };
    if (body.serverId !== undefined) {
      const type = body.mediaType === 'movie' ? 'radarr' : 'sonarr';
      const server = (await this.servers(s.id)).find((x) => x.id === body.serverId && x.type === type);
      if (!server || server.is4k !== body.is4k)
        throw new HttpError(400, 'invalidInput', [{ path: 'serverId', code: 'invalid' }]);
    }
    const created = await s.run(() => this.method(s.adapter, 'createRequest')(body, asUser));
    this.bus.publish({ type: 'requests.updated', audience: 'all' });
    for (const listener of this.createdListeners) listener(created, user);
    return created;
  }

  /** Requests of the user themself. */
  async mine(user: AuthUser, filter: Omit<RequestFilter, 'requestedBy'>, instanceId?: string) {
    const s = this.pick(instanceId);
    const link = await this.linkFor(user, s.id);
    if (link.externalId === null) return { instanceId: s.id, linked: false, total: 0, results: [] };
    const page = await s.run(() =>
      this.method(s.adapter, 'requests')({ ...filter, requestedBy: link.externalId! }),
    );
    return { instanceId: s.id, linked: true, ...page };
  }

  // Admin actions.

  async all(filter: RequestFilter, instanceId?: string) {
    const s = this.pick(instanceId);
    return { instanceId: s.id, ...(await s.run(() => this.method(s.adapter, 'requests')(filter))) };
  }

  async setStatus(instanceId: string, id: number, status: 'approve' | 'decline') {
    const s = this.pick(instanceId);
    const out = await s.run(() => this.method(s.adapter, 'setRequestStatus')(id, status));
    this.bus.publish({ type: 'requests.updated', audience: 'all' });
    return out;
  }

  async edit(instanceId: string, id: number, edit: RequestEdit) {
    const s = this.pick(instanceId);
    const out = await s.run(() => this.method(s.adapter, 'editRequest')(id, edit));
    this.bus.publish({ type: 'requests.updated', audience: 'all' });
    return out;
  }

  async retry(instanceId: string, id: number) {
    const s = this.pick(instanceId);
    const out = await s.run(() => this.method(s.adapter, 'retryRequest')(id));
    this.bus.publish({ type: 'requests.updated', audience: 'all' });
    return out;
  }
}
