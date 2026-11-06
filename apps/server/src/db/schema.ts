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
