// Problems found by Wardarr's Queue Cleaner.
import type { IssueRule } from '../types.js';

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const cleanerHref = (instanceId: string, extra = '') =>
  `/cleaner?instance=${encodeURIComponent(instanceId)}${extra}`;

/** An infrastructure problem pauses the cleaner of an instance. */
export const cleanerPaused: IssueRule<{ reason: string; message: string }> = {
  id: 'cleaner-paused',
  detect(signal) {
    if (signal.kind !== 'cleaner' || signal.source !== 'QueueCleaner.paused') return null;
    return [
      {
        key: signal.instance.id,
        params: { reason: str(signal.data?.reason, 'diskFull'), message: signal.message },
      },
    ];
  },
  build(matches) {
    const instance = matches[0]!.signal.instance;
    const reason = matches[0]!.params.reason;
    return {
      severity: 'critical',
      title: { key: 'issues.cleanerPaused.title', params: { instance: instance.name } },
      affected: { key: `cleaner.infra.${reason}` },
      explanation: { key: 'issues.cleanerPaused.explanation', params: { instance: instance.name } },
      fix: { key: `issues.cleanerPaused.fix.${reason}` },
      actions: [
        {
          id: 'recheck',
          kind: 'recheck',
          class: 'safe',
          label: { key: 'issues.action.recheck' },
          instanceId: instance.id,
        },
        {
          id: 'open-cleaner',
          kind: 'openWardarr',
          class: 'safe',
          label: { key: 'issues.action.openCleaner' },
          href: cleanerHref(instance.id),
        },
      ],
    };
  },
};

/** Blocked downloads whose import preview is clean wait for "Review import". */
export const importReady: IssueRule<{ downloadKey: string; title: string }> = {
  id: 'cleaner-import-ready',
  detect(signal) {
    if (signal.kind !== 'cleaner' || signal.source !== 'QueueCleaner.importReady') return null;
    return [
      {
        key: signal.instance.id,
        params: {
          downloadKey: str(signal.data?.downloadKey),
          title: str(signal.data?.title, signal.message),
        },
      },
    ];
  },
  build(matches) {
    const instance = matches[0]!.signal.instance;
    const unique = new Map(matches.map((m) => [m.params.downloadKey, m.params]));
    const first = [...unique.values()][0]!;
    return {
      severity: 'info',
      title: { key: 'issues.importReady.title', params: { count: unique.size, instance: instance.name } },
      affected: { key: 'issues.importReady.affected', params: { count: unique.size } },
      explanation: { key: 'issues.importReady.explanation' },
      fix: { key: 'issues.importReady.fix' },
      items: [...unique.values()].map((p) => ({ label: p.title, instanceId: instance.id })),
      actions: [
        {
          id: 'review-import',
          kind: 'openWardarr',
          class: 'safe',
          label: { key: 'issues.action.reviewImport' },
          href: cleanerHref(
            instance.id,
            unique.size === 1 ? `&review=${encodeURIComponent(first.downloadKey)}` : '',
          ),
        },
      ],
    };
  },
};

/** Titles that used up their search attempts get no more searches. */
export const attemptsExhausted: IssueRule<{ titleKey: string; title: string; attempts: number }> = {
  id: 'cleaner-attempts-exhausted',
  detect(signal) {
    if (signal.kind !== 'cleaner' || signal.source !== 'QueueCleaner.exhausted') return null;
    const attempts = typeof signal.data?.attempts === 'number' ? signal.data.attempts : 0;
    return [
      {
        key: signal.instance.id,
        params: {
          titleKey: str(signal.data?.titleKey),
          title: str(signal.data?.title, signal.message),
          attempts,
        },
      },
    ];
  },
  build(matches) {
    const instance = matches[0]!.signal.instance;
    const unique = new Map(matches.map((m) => [m.params.titleKey, m.params]));
    return {
      severity: 'warning',
      title: {
        key: 'issues.attemptsExhausted.title',
        params: { count: unique.size, instance: instance.name },
      },
      affected: { key: 'issues.attemptsExhausted.affected', params: { count: unique.size } },
      explanation: {
        key: 'issues.attemptsExhausted.explanation',
        params: { attempts: Math.max(...matches.map((m) => m.params.attempts)) },
      },
      fix: { key: 'issues.attemptsExhausted.fix' },
      items: [...unique.values()].map((p) => ({ label: p.title, instanceId: instance.id })),
      actions: [
        {
          id: 'open-cleaner',
          kind: 'openWardarr',
          class: 'safe',
          label: { key: 'issues.action.openAttempts' },
          href: cleanerHref(instance.id, '&tab=attempts'),
        },
      ],
    };
  },
};

/** Download jobs no *arr instance knows. Wardarr deletes them only after confirmation. */
export const orphanedDownloads: IssueRule<{ jobId: string; name: string }> = {
  id: 'cleaner-orphaned-downloads',
  detect(signal) {
    if (signal.kind !== 'cleaner' || signal.source !== 'QueueCleaner.orphan') return null;
    return [
      {
        key: signal.instance.id,
        params: { jobId: str(signal.data?.jobId), name: str(signal.data?.name, signal.message) },
      },
    ];
  },
  build(matches) {
    const instance = matches[0]!.signal.instance;
    const unique = new Map(matches.map((m) => [m.params.jobId, m.params]));
    return {
      severity: 'info',
      title: { key: 'issues.orphans.title', params: { count: unique.size, instance: instance.name } },
      affected: { key: 'issues.orphans.affected', params: { count: unique.size } },
      explanation: { key: 'issues.orphans.explanation' },
      fix: { key: 'issues.orphans.fix' },
      items: [...unique.values()].map((p) => ({ label: p.name, instanceId: instance.id })),
      actions: [
        {
          id: 'open-orphans',
          kind: 'openWardarr',
          class: 'safe',
          label: { key: 'issues.action.reviewOrphans' },
          href: `/cleaner?tab=orphans&client=${encodeURIComponent(instance.id)}`,
        },
      ],
    };
  },
};
