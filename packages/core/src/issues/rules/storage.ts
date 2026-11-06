// Root folder and path mapping problems of *arr apps.
import type { IssueRule } from '../types.js';
import { listAfterColon } from './helpers.js';

export const rootFolderMissing: IssueRule<{ folders: string[] }> = {
  id: 'root-folder-missing',
  detect(signal) {
    if (signal.kind !== 'health' || signal.source !== 'RootFolderCheck') return null;
    return [{ key: signal.instance.id, params: { folders: listAfterColon(signal.message) } }];
  },
  build(matches, ctx) {
    const instance = matches[0]!.signal.instance;
    const folders = [...new Set(matches.flatMap((m) => m.params.folders))];
    const href = ctx.webUrl(instance.id, { kind: 'settings' });
    return {
      severity: 'critical',
      title: { key: 'issues.rootFolder.title', params: { instance: instance.name } },
      affected: {
        key: 'issues.rootFolder.affected',
        params: { count: folders.length, folders: folders.join(', ') },
      },
      explanation: { key: 'issues.rootFolder.explanation' },
      fix: { key: 'issues.rootFolder.fix' },
      actions: href
        ? [
            {
              id: 'open-instance',
              kind: 'openLink',
              class: 'safe',
              label: { key: 'issues.action.openInstance', params: { name: instance.name } },
              href,
            },
          ]
        : [],
    };
  },
};

export const remotePathMapping: IssueRule<Record<string, never>> = {
  id: 'remote-path-mapping',
  detect(signal) {
    if (signal.kind !== 'health' || signal.source !== 'RemotePathMappingCheck') return null;
    return [{ key: signal.instance.id, params: {} }];
  },
  build(matches, ctx) {
    const instance = matches[0]!.signal.instance;
    const href = ctx.webUrl(instance.id, { kind: 'settings' });
    return {
      severity: 'warning',
      title: { key: 'issues.remotePath.title', params: { instance: instance.name } },
      affected: { key: 'issues.common.instances', params: { instances: instance.name } },
      explanation: { key: 'issues.remotePath.explanation' },
      fix: { key: 'issues.remotePath.fix' },
      actions: [
        {
          id: 'guide',
          kind: 'guide',
          class: 'guide',
          label: { key: 'issues.action.showSteps' },
          steps: [
            { key: 'issues.remotePath.step1' },
            { key: 'issues.remotePath.step2' },
            { key: 'issues.remotePath.step3' },
          ],
        },
        ...(href
          ? [
              {
                id: 'open-instance',
                kind: 'openLink' as const,
                class: 'safe' as const,
                label: { key: 'issues.action.openInstance', params: { name: instance.name } },
                href,
              },
            ]
          : []),
      ],
    };
  },
};

interface DiskParams {
  disk: string;
  label: string;
  level: 'warning' | 'critical';
  reason: 'lowSpace' | 'forecast';
  freeBytes: number;
  totalBytes: number;
  percentFree: number;
  daysLeft: number;
  apps: string;
}

/**
 * A disk is almost full, or Wardarr's forecast says it will be soon. One
 * disk is one issue, however many apps share it.
 */
export const diskFillingUp: IssueRule<DiskParams> = {
  id: 'disk-filling-up',
  detect(signal) {
    if (signal.kind !== 'storage' || signal.source !== 'Storage.disk') return null;
    const d = signal.data ?? {};
    const num = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : 0);
    const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');
    const disk = str('disk');
    if (!disk) return null;
    return [
      {
        key: disk,
        params: {
          disk,
          label: str('label'),
          level: d.level === 'critical' ? 'critical' : 'warning',
          reason: d.reason === 'forecast' ? 'forecast' : 'lowSpace',
          freeBytes: num('freeBytes'),
          totalBytes: num('totalBytes'),
          percentFree: num('percentFree'),
          daysLeft: num('daysLeft'),
          apps: str('apps'),
        },
      },
    ];
  },
  build(matches) {
    const p = matches[0]!.params;
    const days = Math.max(0, Math.round(p.daysLeft));
    const values = { disk: p.label, free: p.freeBytes, percent: Math.round(p.percentFree * 10) / 10 };
    return {
      severity: p.level,
      title: {
        key: p.reason === 'forecast' ? 'issues.diskFilling.titleForecast' : 'issues.diskFilling.titleLow',
        params: { disk: p.label },
      },
      affected:
        p.reason === 'forecast'
          ? { key: 'issues.diskFilling.affectedForecast', params: { ...values, count: days } }
          : { key: 'issues.diskFilling.affectedLow', params: values },
      explanation: { key: 'issues.diskFilling.explanation', params: { disk: p.label, apps: p.apps } },
      fix: { key: 'issues.diskFilling.fix' },
      actions: [
        {
          id: 'open-storage',
          kind: 'openWardarr',
          class: 'safe',
          label: { key: 'issues.action.openStorage' },
          href: `/storage?disk=${encodeURIComponent(p.disk)}`,
        },
        {
          id: 'guide',
          kind: 'guide',
          class: 'guide',
          label: { key: 'issues.action.showSteps' },
          steps: [
            { key: 'issues.diskFilling.step1' },
            { key: 'issues.diskFilling.step2' },
            { key: 'issues.diskFilling.step3' },
          ],
        },
      ],
    };
  },
};
