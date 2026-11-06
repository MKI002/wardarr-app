// Database schema. Migrations in ../../drizzle are generated from this file.
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  kind: text('kind', { enum: ['webhook', 'discord', 'ntfy', 'gotify', 'telegram', 'email'] }).notNull(),
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

/** Cached TRaSH Guides JSON files, by path below the product folder (`radarr/cf/x.json`). */
export const trashFiles = sqliteTable('trash_files', {
  path: text('path').primaryKey(),
  /** Git blob id, so unchanged files are not downloaded again. */
  sha: text('sha').notNull(),
  content: text('content', { mode: 'json' }).$type<unknown>().notNull(),
});

/** State of the TRaSH Guides sync: guide version, settings, changelog. */
export const trashMeta = sqliteTable('trash_meta', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: text('updated_at').notNull().default(now),
});

/** Templates: which TRaSH profiles, formats, sizes and naming an instance gets. */
export const trashTemplates = sqliteTable('trash_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  product: text('product', { enum: ['radarr', 'sonarr'] }).notNull(),
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

/** Template of an instance, its guard mode and what Wardarr manages there. */
export const trashAssignments = sqliteTable('trash_assignments', {
  instanceId: text('instance_id')
    .primaryKey()
    .references(() => instances.id, { onDelete: 'cascade' }),
  templateId: text('template_id')
    .notNull()
    .references(() => trashTemplates.id),
  guardMode: text('guard_mode', { enum: ['off', 'notify', 'auto', 'strict'] })
    .notNull()
    .default('notify'),
  /** Instance ids of the objects Wardarr created or adopted, by sync key. */
  managed: text('managed', { mode: 'json' }).$type<Record<string, number>>().notNull().default({}),
  /** Fields as of the last sync, to tell guide changes from local changes. */
  applied: text('applied', { mode: 'json' }).$type<Record<string, Record<string, unknown>>>(),
  /** Last check: drift counts, pause reason, errors. */
  state: text('state', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  lastSyncAt: text('last_sync_at'),
  updatedAt: text('updated_at').notNull().default(now),
});

/** Every sync and rollback, with the backup taken before it. */
export const trashHistory = sqliteTable(
  'trash_history',
  {
    id: text('id').primaryKey(),
    instanceId: text('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    templateName: text('template_name'),
    at: text('at').notNull(),
    /** `guard` or the id of the user. */
    actor: text('actor').notNull(),
    kind: text('kind', { enum: ['sync', 'rollback'] }).notNull(),
    status: text('status', { enum: ['ok', 'partial', 'failed'] }).notNull(),
    summary: text('summary', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    backup: text('backup', { mode: 'json' }).$type<Record<string, unknown>>(),
    error: text('error'),
    rolledBackAt: text('rolled_back_at'),
  },
  (t) => [index('trash_history_instance_at').on(t.instanceId, t.at)],
);

// ------------------------------------------------------- indexer insights

/** Prowlarr query and grab counts per indexer and time window (hour or day). */
export const indexerStatBuckets = sqliteTable(
  'indexer_stat_buckets',
  {
    instanceId: text('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    indexerId: integer('indexer_id').notNull(),
    indexerName: text('indexer_name').notNull(),
    bucketStart: text('bucket_start').notNull(),
    bucketMinutes: integer('bucket_minutes').notNull(),
    queries: integer('queries').notNull().default(0),
    grabs: integer('grabs').notNull().default(0),
    failedQueries: integer('failed_queries').notNull().default(0),
    failedGrabs: integer('failed_grabs').notNull().default(0),
    rssQueries: integer('rss_queries').notNull().default(0),
    authQueries: integer('auth_queries').notNull().default(0),
    avgResponseMs: real('avg_response_ms'),
    avgGrabResponseMs: real('avg_grab_response_ms'),
  },
  (t) => [
    primaryKey({ columns: [t.instanceId, t.indexerId, t.bucketStart] }),
    index('indexer_stat_buckets_start').on(t.bucketStart),
  ],
);

/** Prowlarr calls per calling app (user agent) and time window. */
export const indexerAgentBuckets = sqliteTable(
  'indexer_agent_buckets',
  {
    instanceId: text('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    agent: text('agent').notNull(),
    bucketStart: text('bucket_start').notNull(),
    bucketMinutes: integer('bucket_minutes').notNull(),
    queries: integer('queries').notNull().default(0),
    grabs: integer('grabs').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.instanceId, t.agent, t.bucketStart] })],
);

/** Indexer state changes seen while polling Prowlarr; outages are derived from these. */
export const indexerStatusLog = sqliteTable(
  'indexer_status_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    instanceId: text('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    indexerId: integer('indexer_id').notNull(),
    indexerName: text('indexer_name').notNull(),
    at: text('at').notNull(),
    failing: integer('failing', { mode: 'boolean' }).notNull(),
  },
  (t) => [index('indexer_status_log_lookup').on(t.instanceId, t.indexerId, t.at)],
);

/** Grabs from *arr history and what became of them. */
export const indexerGrabs = sqliteTable(
  'indexer_grabs',
  {
    instanceId: text('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    downloadId: text('download_id').notNull(),
    /** Indexer name as the app knows it, for example `Lantern (Prowlarr)`. */
    indexer: text('indexer').notNull(),
    grabbedAt: text('grabbed_at').notNull(),
    importedAt: text('imported_at'),
    failedAt: text('failed_at'),
    sizeBytes: integer('size_bytes'),
  },
  (t) => [
    primaryKey({ columns: [t.instanceId, t.downloadId] }),
    index('indexer_grabs_grabbed').on(t.grabbedAt),
  ],
);

/** Daily record of where each app's indexers come from. */
export const indexerSourceDaily = sqliteTable(
  'indexer_source_daily',
  {
    instanceId: text('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    day: text('day').notNull(),
    mode: text('mode').notNull(),
    total: integer('total').notNull(),
    synced: integer('synced').notNull(),
    direct: integer('direct').notNull(),
    duplicate: integer('duplicate').notNull(),
    missing: integer('missing').notNull(),
    orphan: integer('orphan').notNull(),
  },
  (t) => [primaryKey({ columns: [t.instanceId, t.day] })],
);
/**
 * Calendar feed links (iCal). The link carries a random token; the database
 * holds only its SHA-256. One link per user; a new link replaces the old one.
 */
export const calendarFeeds = sqliteTable('calendar_feeds', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
});

/** An app's view of a disk: mount path and the root folders on it. */
export interface DiskMemberRow {
  instanceId: string;
  path: string;
  rootFolders: string[];
}

/** Disks of the *arr apps, one row per physical disk however many apps share it. */
export const disks = sqliteTable('disks', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  totalBytes: integer('total_bytes').notNull(),
  freeBytes: integer('free_bytes').notNull(),
  /** An app keeps a root folder on the disk. */
  media: integer('media', { mode: 'boolean' }).notNull().default(false),
  members: text('members', { mode: 'json' }).$type<DiskMemberRow[]>().notNull().default([]),
  firstSeenAt: text('first_seen_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
});

/** Free space of each disk over time, about once an hour, for the forecast. */
export const diskSamples = sqliteTable(
  'disk_samples',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    diskKey: text('disk_key')
      .notNull()
      .references(() => disks.key, { onDelete: 'cascade' }),
    at: text('at').notNull(),
    freeBytes: integer('free_bytes').notNull(),
    totalBytes: integer('total_bytes').notNull(),
  },
  (t) => [index('disk_samples_disk_at').on(t.diskKey, t.at)],
);

/** Thresholds of the disk issue. A single row with id 1. */
export const storageSettings = sqliteTable('storage_settings', {
  id: integer('id').primaryKey(),
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: text('updated_at').notNull().default(now),
});

/**
 * Transcode nodes (Tdarr) Wardarr has seen. Nodes that disconnect simply
 * vanish from the server's list, so Wardarr remembers them to notice that.
 */
export const transcodeNodes = sqliteTable(
  'transcode_nodes',
  {
    instanceId: text('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    name: text('name').notNull(),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (t) => [uniqueIndex('transcode_nodes_instance_node').on(t.instanceId, t.nodeId)],
);

/**
 * The counters of a transcode server at the end of each day. Tdarr only
 * keeps running totals; the differences between days give the history.
 */
export const transcodeDaily = sqliteTable(
  'transcode_daily',
  {
    instanceId: text('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    /** UTC day, `YYYY-MM-DD`. */
    day: text('day').notNull(),
    transcodes: integer('transcodes').notNull(),
    healthChecks: integer('health_checks').notNull(),
    savedBytes: integer('saved_bytes').notNull(),
    failedTranscodes: integer('failed_transcodes').notNull(),
    failedHealthChecks: integer('failed_health_checks').notNull(),
    queued: integer('queued').notNull(),
  },
  (t) => [uniqueIndex('transcode_daily_instance_day').on(t.instanceId, t.day)],
);
