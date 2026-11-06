// Findings of the TRaSH Guides guard. Drift is information, not an error:
// Wardarr never changes settings because of it unless the guard of the
// instance runs in an auto mode the admin switched on.
import type { IssueAction, IssueRule, RuleOutput, Signal } from '../types.js';

const trashHref = (instanceId: string) => `/trash?instance=${encodeURIComponent(instanceId)}`;
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

const openTrash = (instanceId: string, label = 'issues.action.openTrash'): IssueAction => ({
  id: 'open-trash',
  kind: 'openWardarr',
  class: 'safe',
  label: { key: label },
  href: trashHref(instanceId),
});

function single<P>(
  id: string,
  source: string,
  params: (s: Signal) => P,
  build: (instance: Signal['instance'], p: P) => RuleOutput,
): IssueRule<P> {
  return {
    id,
    detect(signal) {
      if (signal.kind !== 'trash' || signal.source !== source) return null;
      return [{ key: signal.instance.id, params: params(signal) }];
    },
    build(matches) {
      return build(matches[0]!.signal.instance, matches[0]!.params);
    },
  };
}

/** The guide or the template changed since the last sync. */
export const trashGuideDrift = single(
  'trash-guide-drift',
  'Trash.guideDrift',
  (s) => ({ count: num(s.data?.count), template: str(s.data?.template) }),
  (instance, p) => ({
    severity: 'info',
    title: { key: 'issues.trashGuideDrift.title', params: { instance: instance.name } },
    affected: { key: 'issues.trashGuideDrift.affected', params: { count: p.count } },
    explanation: { key: 'issues.trashGuideDrift.explanation', params: { template: p.template } },
    fix: { key: 'issues.trashGuideDrift.fix' },
    actions: [openTrash(instance.id, 'issues.action.previewSync')],
  }),
);

/** Someone changed managed settings in the instance itself. */
export const trashLocalDrift = single(
  'trash-local-drift',
  'Trash.localDrift',
  (s) => ({ count: num(s.data?.count), template: str(s.data?.template) }),
  (instance, p) => ({
    severity: 'info',
    title: { key: 'issues.trashLocalDrift.title', params: { instance: instance.name } },
    affected: { key: 'issues.trashLocalDrift.affected', params: { count: p.count } },
    explanation: {
      key: 'issues.trashLocalDrift.explanation',
      params: { instance: instance.name, template: p.template },
    },
    fix: { key: 'issues.trashLocalDrift.fix' },
    actions: [openTrash(instance.id, 'issues.action.previewSync')],
  }),
);

/** The guard in auto mode found a change it must not apply alone. */
export const trashSyncPaused = single(
  'trash-sync-paused',
  'Trash.syncPaused',
  (s) => ({ reason: str(s.data?.reason, 'manyChanges') }),
  (instance, p) => ({
    severity: 'warning',
    title: { key: 'issues.trashSyncPaused.title', params: { instance: instance.name } },
    affected: { key: `issues.trashSyncPaused.reason.${p.reason}` },
    explanation: { key: 'issues.trashSyncPaused.explanation' },
    fix: { key: 'issues.trashSyncPaused.fix' },
    actions: [openTrash(instance.id, 'issues.action.previewSync')],
  }),
);

/** A sync stopped with an error. Its backup can undo the part that ran. */
export const trashSyncFailed = single(
  'trash-sync-failed',
  'Trash.syncFailed',
  (s) => ({ message: s.message }),
  (instance, p) => ({
    severity: 'warning',
    title: { key: 'issues.trashSyncFailed.title', params: { instance: instance.name } },
    affected: { key: 'issues.trashSyncFailed.affected', params: { message: p.message } },
    explanation: { key: 'issues.trashSyncFailed.explanation' },
    fix: { key: 'issues.trashSyncFailed.fix' },
    actions: [openTrash(instance.id, 'issues.action.openTrashHistory')],
  }),
);

/** Sonarr v3 and older products have no custom formats. */
export const trashUnsupported = single(
  'trash-unsupported-version',
  'Trash.unsupportedVersion',
  () => ({}),
  (instance) => ({
    severity: 'info',
    title: { key: 'issues.trashUnsupported.title', params: { instance: instance.name } },
    affected: { key: 'issues.trashUnsupported.affected' },
    explanation: { key: 'issues.trashUnsupported.explanation', params: { instance: instance.name } },
    fix: { key: 'issues.trashUnsupported.fix' },
    actions: [openTrash(instance.id)],
  }),
);

/** The guide could not be downloaded. One issue for all instances. */
export const trashGuideFetchFailed: IssueRule<Record<string, never>> = {
  id: 'trash-guide-fetch-failed',
  detect(signal) {
    if (signal.kind !== 'trash' || signal.source !== 'Trash.guideFetchFailed') return null;
    return [{ key: 'guide', params: {} }];
  },
  build(matches) {
    const count = new Set(matches.map((m) => m.signal.instance.id)).size;
    return {
      severity: 'info',
      title: { key: 'issues.trashGuideFetch.title' },
      affected: { key: 'issues.trashGuideFetch.affected', params: { count } },
      explanation: { key: 'issues.trashGuideFetch.explanation' },
      fix: { key: 'issues.trashGuideFetch.fix' },
      actions: [
        {
          id: 'open-trash',
          kind: 'openWardarr',
          class: 'safe',
          label: { key: 'issues.action.openTrash' },
          href: '/trash',
        },
      ],
    };
  },
};
