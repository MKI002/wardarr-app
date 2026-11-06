// Instances and their credentials. Secret fields are encrypted at rest and
// never leave this module in clear text except towards the adapter.
import { asc, eq } from 'drizzle-orm';
import type { AdapterDefinition } from '@wardarr/core';
import type { Db } from '../db/index.js';
import { instances } from '../db/schema.js';
import { newId } from '../auth/sessions.js';
import { HttpError } from '../http/validate.js';
import { checkUrl } from '../net/ssrf.js';
import type { SecretBox } from '../security/crypto.js';
import type { AdapterRegistry } from './registry.js';

export type InstanceRow = typeof instances.$inferSelect;

export interface InstanceOptions {
  pollIntervalSeconds?: number;
  timeoutMs?: number;
}

/** What the API returns. Secret fields only say whether they are set. */
export interface PublicInstance {
  id: string;
  adapter: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  allowInsecureTls: boolean;
  fields: Record<string, string | number | boolean | { isSet: boolean } | null>;
  options: InstanceOptions;
}

export interface InstanceInput {
  adapter: string;
  name: string;
  baseUrl: string;
  fields: Record<string, unknown>;
  enabled?: boolean;
  allowInsecureTls?: boolean;
  options?: InstanceOptions;
}

export function normalizeBaseUrl(raw: string): string {
  const check = checkUrl(raw.trim());
  if (!check.ok) throw new HttpError(400, 'invalidUrl', { reason: check.reason });
  const url = check.url;
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

function secretKeys(def: AdapterDefinition<Record<string, unknown>>): Set<string> {
  return new Set(def.fields.filter((f) => f.kind === 'secret').map((f) => f.key));
}

export class InstanceStore {
  constructor(
    private readonly db: Db,
    private readonly box: SecretBox,
    private readonly registry: AdapterRegistry,
  ) {}

  list(): InstanceRow[] {
    return this.db.select().from(instances).orderBy(asc(instances.sortOrder), asc(instances.name)).all();
  }

  get(id: string): InstanceRow | undefined {
    return this.db.select().from(instances).where(eq(instances.id, id)).get();
  }

  definition(row: Pick<InstanceRow, 'adapter'>): AdapterDefinition<Record<string, unknown>> {
    const def = this.registry.get(row.adapter);
    if (!def) throw new HttpError(400, 'unknownAdapter');
    return def;
  }

  toPublic(row: InstanceRow): PublicInstance {
    const def = this.registry.get(row.adapter);
    const fields: PublicInstance['fields'] = {};
    const secrets = row.secretFields ? this.secrets(row) : {};
    for (const f of def?.fields ?? []) {
      if (f.kind === 'secret')
        fields[f.key] = { isSet: typeof secrets[f.key] === 'string' && secrets[f.key] !== '' };
      else fields[f.key] = (row.publicFields[f.key] as string | number | boolean | undefined) ?? null;
    }
    return {
      id: row.id,
      adapter: row.adapter,
      name: row.name,
      baseUrl: row.baseUrl,
      enabled: row.enabled,
      allowInsecureTls: row.allowInsecureTls,
      fields,
      options: row.options as InstanceOptions,
    };
  }

  /**
   * Validates input against the adapter schema. Empty secret fields keep the
   * stored value, so the UI never needs to know it.
   */
  resolveCredentials(
    def: AdapterDefinition<Record<string, unknown>>,
    fields: Record<string, unknown>,
    existing?: InstanceRow,
  ): {
    publicFields: Record<string, unknown>;
    secretFields: Record<string, unknown>;
    merged: Record<string, unknown>;
  } {
    const secretSet = secretKeys(def);
    const previous = existing?.secretFields ? this.secrets(existing) : {};
    const publicFields: Record<string, unknown> = {};
    const secretFields: Record<string, unknown> = {};
    for (const f of def.fields) {
      const value = fields[f.key];
      if (secretSet.has(f.key)) {
        if (typeof value === 'string' && value !== '') secretFields[f.key] = value;
        else if (previous[f.key] !== undefined) secretFields[f.key] = previous[f.key];
      } else if (value !== undefined && value !== '') {
        publicFields[f.key] = value;
      } else if (existing && existing.publicFields[f.key] !== undefined && value === undefined) {
        publicFields[f.key] = existing.publicFields[f.key];
      }
    }
    const merged = { ...publicFields, ...secretFields };
    const parsed = def.credentials.safeParse(merged);
    if (!parsed.success) {
      throw new HttpError(
        400,
        'invalidCredentials',
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
      );
    }
    return { publicFields, secretFields, merged: parsed.data };
  }

  create(input: InstanceInput): InstanceRow {
    const def = this.registry.get(input.adapter);
    if (!def) throw new HttpError(400, 'unknownAdapter');
    const baseUrl = normalizeBaseUrl(input.baseUrl);
    const { publicFields, secretFields } = this.resolveCredentials(def, input.fields);
    const id = newId();
    this.assertUniqueName(input.name);
    this.db
      .insert(instances)
      .values({
        id,
        adapter: def.id,
        name: input.name.trim(),
        baseUrl,
        publicFields,
        secretFields: this.box.encrypt(JSON.stringify(secretFields), id),
        enabled: input.enabled ?? true,
        allowInsecureTls: input.allowInsecureTls ?? false,
        options: input.options ?? {},
        sortOrder: this.list().length,
      })
      .run();
    return this.get(id)!;
  }

  update(id: string, input: Partial<Omit<InstanceInput, 'adapter'>>): InstanceRow {
    const row = this.get(id);
    if (!row) throw new HttpError(404, 'notFound');
    const def = this.definition(row);
    const patch: Partial<typeof instances.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (input.name !== undefined && input.name.trim() !== row.name) {
      this.assertUniqueName(input.name);
      patch.name = input.name.trim();
    }
    if (input.baseUrl !== undefined) patch.baseUrl = normalizeBaseUrl(input.baseUrl);
    if (input.fields !== undefined) {
      const { publicFields, secretFields } = this.resolveCredentials(def, input.fields, row);
      patch.publicFields = publicFields;
      patch.secretFields = this.box.encrypt(JSON.stringify(secretFields), id);
    }
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.allowInsecureTls !== undefined) patch.allowInsecureTls = input.allowInsecureTls;
    if (input.options !== undefined)
      patch.options = { ...(row.options as InstanceOptions), ...input.options };
    this.db.update(instances).set(patch).where(eq(instances.id, id)).run();
    return this.get(id)!;
  }

  delete(id: string): void {
    this.db.delete(instances).where(eq(instances.id, id)).run();
  }

  /** Full credentials for the adapter. Never return this from an API. */
  credentials(row: InstanceRow): Record<string, unknown> {
    return { ...row.publicFields, ...this.secrets(row) };
  }

  private secrets(row: InstanceRow): Record<string, unknown> {
    if (!row.secretFields) return {};
    return JSON.parse(this.box.decrypt(row.secretFields, row.id)) as Record<string, unknown>;
  }

  private assertUniqueName(name: string): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 64) throw new HttpError(400, 'invalidName');
    const clash = this.db
      .select({ id: instances.id })
      .from(instances)
      .where(eq(instances.name, trimmed))
      .get();
    if (clash) throw new HttpError(409, 'nameTaken');
  }
}
