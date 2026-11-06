// Types and helpers of the TRaSH Guides tab.
import type { SyncPlan, TemplateConfig, TemplateProfile, TrashProduct, TrashWarning } from '@wardarr/core';
import type { Tone } from '../components/ui';

export type { SyncPlan, TemplateConfig, TemplateProfile, TrashProduct, TrashWarning };
export type GuardMode = 'off' | 'notify' | 'auto' | 'strict';
export type ChangeOrigin = 'guide' | 'local' | 'initial';

export interface GuideState {
  version: string | null;
  date: string | null;
  fetchedAt: string | null;
  checkedAt: string | null;
  error: string | null;
  source: string;
  skipped: Array<{ path: string; reason: string }>;
}

export interface TrashSettings {
  repo: string;
  branch: string;
  refreshHours: number;
  guardHours: number;
  maxAutoChanges: number;
  backupsPerInstance: number;
}

export interface AssignmentState {
  checkedAt?: string;
  error?: string | null;
  counts?: Record<ChangeOrigin, number>;
  removable?: number;
  pause?: { reasons: string[]; at: string } | null;
  lastSync?: { at: string; status: 'ok' | 'partial' | 'failed'; historyId: string; error?: string | null };
}

export interface TrashInstance {
  id: string;
  name: string;
  adapter: string;
  product: TrashProduct;
  version: string | null;
  status: string;
  templateId: string | null;
  templateName: string | null;
  guardMode: GuardMode;
  lastSyncAt: string | null;
  neverSynced: boolean;
  state: AssignmentState;
}

export interface TrashTemplate {
  id: string;
  name: string;
  product: TrashProduct;
  config: TemplateConfig;
  updatedAt: string;
}

export interface GuideChange {
  kind: 'customFormat' | 'qualityProfile' | 'cfGroup' | 'qualitySize' | 'naming';
  id: string;
  name: string;
  change: 'added' | 'removed' | 'changed';
  parts?: string[];
}

export interface ChangelogEntry {
  at: string;
  from: string | null;
  to: string;
  changes: Partial<Record<TrashProduct, GuideChange[]>>;
}

export interface TrashOverview {
  guide: GuideState;
  settings: TrashSettings;
  instances: TrashInstance[];
  templates: TrashTemplate[];
  changelog: ChangelogEntry[];
}

export interface CatalogProfile {
  trashId: string;
  name: string;
  description: string;
  url: string | null;
  category: string;
  scoreSet: string;
  qualitySize: string | null;
  formats: string[];
  groups: string[];
  suggested: TemplateProfile;
  cutoff: string;
  qualities: Array<{ name: string; allowed: boolean; items?: string[] }>;
}

export interface Catalog {
  product: TrashProduct;
  categories: string[];
  profiles: CatalogProfile[];
  groups: Array<{
    trashId: string;
    name: string;
    description: string;
    recommended: boolean;
    formats: Array<{ trashId: string; name: string; required: boolean; preselected: boolean }>;
  }>;
  customFormats: Array<{
    trashId: string;
    name: string;
    scores: Record<string, number>;
    description: string | null;
  }>;
  qualitySizes: Array<{ trashId: string; type: string }>;
  naming: Record<string, Record<string, string>>;
  conflicts: string[][];
}

export interface Explanation {
  warnings: TrashWarning[];
  counts: { customFormats: number; qualityProfiles: number };
  profiles: Array<{
    trashId: string;
    name: string;
    scoreSet: string;
    formats: Array<{
      trashId: string;
      name: string;
      guideScore: number;
      score: number;
      source: 'profile' | 'group' | 'extra';
      group: string | null;
    }>;
  }>;
}

export interface Preview {
  template: { id: string; name: string };
  neverSynced: boolean;
  plan: SyncPlan;
  brakes: string[];
}

export interface HistoryEntry {
  id: string;
  instanceId: string;
  instanceName: string | null;
  templateName: string | null;
  at: string;
  actor: string;
  kind: 'sync' | 'rollback';
  status: 'ok' | 'partial' | 'failed';
  summary: {
    counts?: { create: number; update: number; remove: number; fields: number };
    restored?: number;
    objects?: Array<{ kind: string; label: string; action: string; fields: number }>;
  };
  error: string | null;
  rolledBackAt: string | null;
  hasBackup: boolean;
}

export const STATUS_TONE: Record<'ok' | 'partial' | 'failed', Tone> = {
  ok: 'ok',
  partial: 'warning',
  failed: 'critical',
};
export const ORIGIN_TONE: Record<ChangeOrigin, Tone> = {
  guide: 'info',
  local: 'warning',
  initial: 'neutral',
};

/** Short form of a commit id. */
export const shortVersion = (v: string | null) => (v ? v.slice(0, 7) : '—');

export function emptyConfig(): TemplateConfig {
  return { profiles: [], qualitySize: null, naming: {}, rename: true };
}

/** Readable value of a plan field for the diff view. */
export function showValue(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.every((x) => x && typeof x === 'object' && 'allowed' in x)) {
      return (v as Array<{ name: string; allowed: boolean; items?: string[] }>)
        .filter((x) => x.allowed)
        .map((x) => (x.items?.length ? `${x.name} (${x.items.join(', ')})` : x.name))
        .join(' › ');
    }
    if (v.every((x) => x && typeof x === 'object' && 'implementation' in x)) {
      return (v as Array<{ name: string; negate: boolean; fields: Record<string, unknown> }>)
        .map((s) => `${s.negate ? 'NOT ' : ''}${s.name}: ${Object.values(s.fields).map(String).join(', ')}`)
        .join(' · ');
    }
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('min' in o && 'max' in o)
      return `${String(o.min)} / ${String(o.preferred ?? '—')} / ${String(o.max ?? '∞')}`;
  }
  return JSON.stringify(v);
}
