// Database schema. Migrations in ../../drizzle are generated from this file.
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name'),
  role: text('role', { enum: ['admin', 'user'] }).notNull(),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  /** UI preferences such as language and theme, as JSON. */
  preferences: text('preferences', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  createdAt: text('created_at').notNull().default(now),
});

/**
 * Login methods of a user. `local` stores an argon2id hash; OIDC will add
 * rows with provider `oidc` and the subject claim, without schema changes.
 */
export const authIdentities = sqliteTable(
  'auth_identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    passwordHash: text('password_hash'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('auth_identities_provider_subject').on(t.provider, t.subject)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    /** SHA-256 of the session token; the token itself is never stored. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    csrfToken: text('csrf_token').notNull(),
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('sessions_user').on(t.userId)],
);

export const instances = sqliteTable('instances', {
  id: text('id').primaryKey(),
  adapter: text('adapter').notNull(),
  name: text('name').notNull().unique(),
  baseUrl: text('base_url').notNull(),
  /** Non-secret credential fields as JSON. */
  publicFields: text('public_fields', { mode: 'json' })
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  /** Secret credential fields, AES-256-GCM encrypted JSON. */
  secretFields: text('secret_fields'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  allowInsecureTls: integer('allow_insecure_tls', { mode: 'boolean' }).notNull().default(false),
  /** Per-instance options such as poll interval and timeout. */
  options: text('options', { mode: 'json' })
    .$type<{ pollIntervalSeconds?: number; timeoutMs?: number }>()
    .notNull()
    .default({}),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

export const issues = sqliteTable(
  'issues',
  {
    fingerprint: text('fingerprint').primaryKey(),
    status: text('status', { enum: ['open', 'resolved'] }).notNull(),
    origin: text('origin', { enum: ['service', 'wardarr'] }).notNull(),
    severity: text('severity', { enum: ['critical', 'warning', 'info'] }).notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    resolvedAt: text('resolved_at'),
    mutedUntil: text('muted_until'),
    mutedForever: integer('muted_forever', { mode: 'boolean' }).notNull().default(false),
    /** The full group as JSON. */
    group: text('group_json', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index('issues_status').on(t.status)],
);

export const issueEvents = sqliteTable(
  'issue_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fingerprint: text('fingerprint').notNull(),
    type: text('type').notNull(),
    severity: text('severity').notNull(),
    at: text('at').notNull(),
    actorUserId: text('actor_user_id'),
  },
  (t) => [index('issue_events_fingerprint').on(t.fingerprint, t.at)],
);

/** Settings and remembered state of a feature (cleaner, hunting) per instance. */
export const featureSettings = sqliteTable(
  'feature_settings',
  {
    instanceId: text('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    feature: text('feature').notNull(),
    config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    state: text('state', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('feature_settings_instance_feature').on(t.instanceId, t.feature)],
);

/** Every decision and action of the Queue Cleaner, with its rule and reason. */
export const cleanerHistory = sqliteTable(
  'cleaner_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    instanceId: text('instance_id').notNull(),
    at: text('at').notNull(),
    downloadKey: text('download_key').notNull(),
    title: text('title').notNull(),
    kind: text('kind').notNull(),
    rule: text('rule').notNull(),
    reason: text('reason', { mode: 'json' })
      .$type<{ key: string; params?: Record<string, string | number> }>()
      .notNull(),
    dryRun: integer('dry_run', { mode: 'boolean' }).notNull(),
    ok: integer('ok', { mode: 'boolean' }).notNull(),
    error: text('error'),
    actorUserId: text('actor_user_id'),
  },
  (t) => [index('cleaner_history_instance_at').on(t.instanceId, t.at)],
);

/** Searches started by Hunting and their result from the *arr history. */
export const huntSearches = sqliteTable(
  'hunt_searches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    instanceId: text('instance_id').notNull(),
    key: text('key').notNull(),
    itemKeys: text('item_keys', { mode: 'json' }).$type<string[]>().notNull(),
    title: text('title').notNull(),
    list: text('list', { enum: ['missing', 'cutoff'] }).notNull(),
    mediaIds: text('media_ids', { mode: 'json' }).$type<number[]>().notNull(),
    reason: text('reason', { mode: 'json' })
      .$type<{ key: string; params?: Record<string, string | number> }>()
      .notNull(),
    at: text('at').notNull(),
    manual: integer('manual', { mode: 'boolean' }).notNull().default(false),
    result: text('result', { enum: ['pending', 'nothing', 'grabbed', 'imported', 'failed'] }).notNull(),
  },
  (t) => [
    index('hunt_searches_instance_at').on(t.instanceId, t.at),
    index('hunt_searches_instance_key').on(t.instanceId, t.key),
  ],
);

/** Titles the user excluded from Hunting. */
export const huntExclusions = sqliteTable(
  'hunt_exclusions',
  {
    instanceId: text('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    title: text('title').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [uniqueIndex('hunt_exclusions_instance_key').on(t.instanceId, t.key)],
);

/**
 * Plays seen on media servers. Wardarr records them from the session polls;
 * a play ends when its session is gone.
 */
export const streamHistory = sqliteTable(
  'stream_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    instanceId: text('instance_id').notNull(),
    sessionId: text('session_id').notNull(),
    user: text('user').notNull(),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    mediaType: text('media_type').notNull(),
    startedAt: text('started_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    endedAt: text('ended_at'),
    /** Time seen playing, from the polls. */
    playedMs: integer('played_ms').notNull().default(0),
    durationMs: integer('duration_ms'),
    /** Furthest position seen, in percent. */
    progress: integer('progress').notNull().default(0),
    transcoding: integer('transcoding', { mode: 'boolean' }).notNull().default(false),
    resolution: text('resolution'),
    client: text('client'),
  },
  (t) => [
    index('stream_history_started').on(t.startedAt),
    index('stream_history_open').on(t.instanceId, t.endedAt),
  ],
);

/** Which Seerr user a Wardarr user requests as. */
export const requestLinks = sqliteTable(
  'request_links',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instanceId: text('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    externalId: integer('external_id').notNull(),
    externalName: text('external_name').notNull(),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('request_links_user_instance').on(t.userId, t.instanceId)],
);

/** Where Wardarr sends notifications, and which events it sends there. */
export const notificationChannels = sqliteTable('notification_channels', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  kind: text('kind', { enum: ['webhook', 'discord', 'ntfy', 'gotify', 'telegram'] }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** Non-secret settings such as the server address or topic. */
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  /** Secret settings (tokens, webhook URLs), AES-256-GCM encrypted JSON. */
  secret: text('secret'),
  events: text('events', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  language: text('language').notNull().default('en'),
  lastSentAt: text('last_sent_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});
