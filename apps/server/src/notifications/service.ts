// Notifications: new and resolved issues and requests waiting for approval,
// sent to webhooks, Discord, ntfy, Gotify or Telegram.
//
// An issue is announced only after a short grace period, so a problem that
// fixes itself within a minute never pings anyone. Each channel has a rate
// limit, and a resolved message only goes where the issue was announced.
import { randomUUID } from 'node:crypto';
import { AdapterError, type IssueEvent, type MediaRequest } from '@wardarr/core';
import type { Language } from '@wardarr/i18n';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import { notificationChannels } from '../db/schema.js';
import { HttpError } from '../http/validate.js';
import type { IssueService } from '../issues/service.js';
import { createHttpClient } from '../net/httpClient.js';
import { checkUrl } from '../net/ssrf.js';
import type { SecretBox } from '../security/crypto.js';
import { renderMsg, t } from './render.js';
import {
  KIND_SCHEMAS,
  SECRET_FIELDS,
  buildRequest,
  targetUrls,
  type ChannelKind,
  type Level,
  type Notification,
} from './senders.js';

export type Threshold = 'critical' | 'warning' | 'info' | 'off';

export interface ChannelEvents {
  /** Lowest severity of new issues to announce. */
  issueOpened: Threshold;
  issueResolved: boolean;
  requestPending: boolean;
}

export const DEFAULT_EVENTS: ChannelEvents = {
  issueOpened: 'warning',
  issueResolved: true,
  requestPending: true,
};

const RANK: Record<string, number> = { critical: 0, warning: 1, info: 2, off: 99 };
const RATE_WINDOW_MS = 10 * 60_000;
const RATE_MAX = 20;

export interface ChannelInput {
  name: string;
  kind: ChannelKind;
  enabled: boolean;
  language: Language;
  events: ChannelEvents;
  config: Record<string, unknown>;
  /** Secret fields; a missing or empty field keeps the stored value. */
  secret: Record<string, unknown>;
}

export interface ChannelView {
  id: string;
  name: string;
  kind: ChannelKind;
  enabled: boolean;
  language: Language;
  events: ChannelEvents;
  config: Record<string, unknown>;
  /** Which secret fields are set. Secret values never leave the server. */
  secrets: Record<string, { isSet: boolean }>;
  lastSentAt: string | null;
  lastError: string | null;
}

type Row = typeof notificationChannels.$inferSelect;

export interface NotificationOptions {
  publicUrl?: string;
  graceMs?: number;
  retryMs?: number;
  now?: () => Date;
  /** Replaces the HTTP call, for tests. */
  send?: (out: ReturnType<typeof buildRequest>) => Promise<{ status: number }>;
}

export class NotificationService {
  private readonly pending = new Map<string, NodeJS.Timeout>();
  /** Channels each open issue was announced on, with the severity announced. */
  private readonly announced = new Map<string, Map<string, string>>();
  private readonly sent = new Map<string, number[]>();
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly issues: IssueService,
    private readonly log: FastifyBaseLogger,
    private readonly opts: NotificationOptions = {},
  ) {
    issues.onEvents((events) => this.onIssueEvents(events));
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  // Channels.

  private view(row: Row): ChannelView {
    const secret = this.secretOf(row);
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      enabled: row.enabled,
      language: (row.language === 'de' ? 'de' : 'en') as Language,
      events: { ...DEFAULT_EVENTS, ...(row.events as Partial<ChannelEvents>) },
      config: row.config,
      secrets: Object.fromEntries(
        SECRET_FIELDS[row.kind].map((k) => [k, { isSet: typeof secret[k] === 'string' && secret[k] !== '' }]),
      ),
      lastSentAt: row.lastSentAt,
      lastError: row.lastError,
    };
  }

  private secretOf(row: Row): Record<string, unknown> {
    if (!row.secret) return {};
    try {
      return JSON.parse(this.box.decrypt(row.secret, `notification:${row.id}`)) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private rows(): Row[] {
    return this.db.select().from(notificationChannels).all();
  }

  private row(id: string): Row {
    const row = this.db.select().from(notificationChannels).where(eq(notificationChannels.id, id)).get();
    if (!row) throw new HttpError(404, 'notFound');
    return row;
  }

  list(): ChannelView[] {
    return this.rows()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => this.view(r));
  }

  private validate(input: ChannelInput, previousSecret: Record<string, unknown>) {
    const schemas = KIND_SCHEMAS[input.kind];
    const config = schemas.config.safeParse(input.config);
    const kept: Record<string, unknown> = {};
    for (const k of SECRET_FIELDS[input.kind]) {
      const v = input.secret[k];
      if (typeof v === 'string' && v.trim() !== '') kept[k] = v.trim();
      else if (previousSecret[k] !== undefined) kept[k] = previousSecret[k];
    }
    const secret = schemas.secret.safeParse(kept);
    if (!config.success || !secret.success) {
      const issues = [...(config.error?.issues ?? []), ...(secret.error?.issues ?? [])];
      throw new HttpError(
        400,
        'invalidInput',
        issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
      );
    }
    for (const target of targetUrls(input.kind, config.data, secret.data)) {
      const check = checkUrl(target);
      if (!check.ok) throw new HttpError(400, 'invalidUrl', { reason: check.reason });
    }
    return { config: config.data as Record<string, unknown>, secret: secret.data as Record<string, unknown> };
  }

  private nameTaken(name: string, exceptId?: string): boolean {
    return this.rows().some((r) => r.id !== exceptId && r.name.toLowerCase() === name.trim().toLowerCase());
  }

  create(input: ChannelInput): ChannelView {
    if (this.nameTaken(input.name)) throw new HttpError(409, 'nameTaken');
    const { config, secret } = this.validate(input, {});
    const id = randomUUID();
    this.db
      .insert(notificationChannels)
      .values({
        id,
        name: input.name.trim(),
        kind: input.kind,
        enabled: input.enabled,
        language: input.language,
        events: input.events as unknown as Record<string, unknown>,
        config,
        secret: this.box.encrypt(JSON.stringify(secret), `notification:${id}`),
      })
      .run();
    return this.view(this.row(id));
  }

  update(id: string, input: ChannelInput): ChannelView {
    const row = this.row(id);
    if (row.kind !== input.kind)
      throw new HttpError(400, 'invalidInput', [{ path: 'kind', code: 'immutable' }]);
    if (this.nameTaken(input.name, id)) throw new HttpError(409, 'nameTaken');
    const { config, secret } = this.validate(input, this.secretOf(row));
    this.db
      .update(notificationChannels)
      .set({
        name: input.name.trim(),
        enabled: input.enabled,
        language: input.language,
        events: input.events as unknown as Record<string, unknown>,
        config,
        secret: this.box.encrypt(JSON.stringify(secret), `notification:${id}`),
        updatedAt: this.now().toISOString(),
      })
      .where(eq(notificationChannels.id, id))
      .run();
    return this.view(this.row(id));
  }

  delete(id: string): void {
    this.row(id);
    this.db.delete(notificationChannels).where(eq(notificationChannels.id, id)).run();
    for (const map of this.announced.values()) map.delete(id);
  }

  async test(id: string): Promise<{ ok: boolean; error: string | null }> {
    const row = this.row(id);
    const lang = this.view(row).language;
    const error = await this.deliver(
      row,
      {
        event: 'test',
        level: 'info',
        title: t(lang, 'notifications.test.title'),
        body: t(lang, 'notifications.test.body'),
        url: this.link('/'),
        at: this.now().toISOString(),
      },
      false,
    );
    return { ok: error === null, error };
  }

  // Delivery.

  private link(path: string): string | null {
    return this.opts.publicUrl ? `${this.opts.publicUrl}${path}` : null;
  }

  private allowed(channelId: string): boolean {
    const now = this.now().getTime();
    const recent = (this.sent.get(channelId) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX) {
      this.sent.set(channelId, recent);
      return false;
    }
    recent.push(now);
    this.sent.set(channelId, recent);
    return true;
  }

  /** Sends one notification. Returns the error kind, or null on success. */
  private async deliver(row: Row, n: Notification, retry: boolean): Promise<string | null> {
    if (n.event !== 'test' && !this.allowed(row.id)) {
      this.record(row.id, 'rateLimited');
      return 'rateLimited';
    }
    let error: string | null = null;
    try {
      const out = buildRequest(row.kind, row.config, this.secretOf(row), n);
      const send =
        this.opts.send ??
        (async (o: typeof out) =>
          createHttpClient({ baseUrl: o.baseUrl, timeoutMs: 10_000, followRedirects: false }).request(
            o.request,
          ));
      const res = await send(out);
      if (res.status < 200 || res.status >= 300)
        error = res.status === 401 || res.status === 403 ? 'unauthorized' : 'badResponse';
    } catch (err) {
      error = err instanceof AdapterError ? err.kind : 'unreachable';
    }
    this.record(row.id, error);
    if (error) {
      this.log.warn({ channel: row.id, kind: row.kind, error }, 'notification failed');
      if (retry && error !== 'unauthorized') {
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          const fresh = this.db
            .select()
            .from(notificationChannels)
            .where(eq(notificationChannels.id, row.id))
            .get();
          if (fresh?.enabled) void this.deliver(fresh, n, false);
        }, this.opts.retryMs ?? 30_000);
        timer.unref?.();
        this.timers.add(timer);
      }
    }
    return error;
  }

  private record(id: string, error: string | null): void {
    this.db
      .update(notificationChannels)
      .set(error ? { lastError: error } : { lastError: null, lastSentAt: this.now().toISOString() })
      .where(eq(notificationChannels.id, id))
      .run();
  }

  private channels(): Array<{ row: Row; view: ChannelView }> {
    return this.rows()
      .filter((r) => r.enabled)
      .map((row) => ({ row, view: this.view(row) }));
  }

  // Issues.

  private onIssueEvents(events: IssueEvent[]): void {
    for (const e of events) {
      if (e.type === 'resolved') {
        const timer = this.pending.get(e.fingerprint);
        if (timer) {
          // Opened and resolved within the grace period: nobody needs to know.
          clearTimeout(timer);
          this.pending.delete(e.fingerprint);
          continue;
        }
        void this.announceResolved(e.fingerprint);
        continue;
      }
      // opened, reopened or severityChanged
      const existing = this.pending.get(e.fingerprint);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        this.pending.delete(e.fingerprint);
        void this.announceOpened(e.fingerprint);
      }, this.opts.graceMs ?? 60_000);
      timer.unref?.();
      this.pending.set(e.fingerprint, timer);
    }
  }

  private async announceOpened(fingerprint: string): Promise<void> {
    let issue;
    try {
      issue = this.issues.get(fingerprint);
    } catch {
      return;
    }
    if (issue.status !== 'open' || issue.muted) return;
    const severity = issue.group.severity;
    const done = this.announced.get(fingerprint) ?? new Map<string, string>();
    this.announced.set(fingerprint, done);
    await Promise.all(
      this.channels().map(async ({ row, view }) => {
        if (RANK[severity]! > RANK[view.events.issueOpened]!) return;
        const before = done.get(row.id);
        // Announce again only when the issue became more severe.
        if (before !== undefined && RANK[severity]! >= RANK[before]!) return;
        const lang = view.language;
        const body = [renderMsg(lang, issue.group.affected), renderMsg(lang, issue.group.fix)]
          .filter(Boolean)
          .join('\n\n');
        const error = await this.deliver(
          row,
          {
            event: 'issueOpened',
            level: severity as Level,
            title: renderMsg(lang, issue.group.title),
            body,
            url: this.link(`/issues?focus=${encodeURIComponent(fingerprint)}`),
            at: this.now().toISOString(),
          },
          true,
        );
        if (error !== 'rateLimited') done.set(row.id, severity);
      }),
    );
  }

  private async announceResolved(fingerprint: string): Promise<void> {
    const done = this.announced.get(fingerprint);
    this.announced.delete(fingerprint);
    if (!done || done.size === 0) return;
    let group;
    try {
      group = this.issues.get(fingerprint).group;
    } catch {
      return;
    }
    await Promise.all(
      this.channels()
        .filter(({ row, view }) => done.has(row.id) && view.events.issueResolved)
        .map(({ row, view }) => {
          const title = renderMsg(view.language, group.title);
          return this.deliver(
            row,
            {
              event: 'issueResolved',
              level: 'ok',
              title: t(view.language, 'notifications.resolved.title', { title }),
              body: t(view.language, 'notifications.resolved.body'),
              url: this.link('/issues?view=resolved'),
              at: this.now().toISOString(),
            },
            true,
          );
        }),
    );
  }

  // Requests.

  /** A request that waits for approval. */
  async requestPending(req: MediaRequest, requestedBy: string): Promise<void> {
    if (req.status !== 'pending') return;
    await Promise.all(
      this.channels()
        .filter(({ view }) => view.events.requestPending)
        .map(({ row, view }) => {
          const lang = view.language;
          const title = req.title ?? t(lang, 'notifications.request.unknownTitle');
          return this.deliver(
            row,
            {
              event: 'requestPending',
              level: 'info',
              title: t(lang, 'notifications.request.title', { title }),
              body: t(lang, req.is4k ? 'notifications.request.body4k' : 'notifications.request.body', {
                user: requestedBy,
              }),
              url: this.link('/requests'),
              at: this.now().toISOString(),
            },
            true,
          );
        }),
    );
  }

  stop(): void {
    for (const timer of [...this.pending.values(), ...this.timers]) clearTimeout(timer);
    this.pending.clear();
    this.timers.clear();
  }
}
