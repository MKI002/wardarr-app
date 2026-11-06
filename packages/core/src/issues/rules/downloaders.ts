// Problems that download clients report about themselves.
//
// Adapters emit `health` signals with these sources:
// - `Downloader.connection`  data.status 'disconnected' | 'firewalled'
// - `Downloader.trackerError` one signal per torrent, data.name + data.reason
// - `Downloader.paused`       downloads are paused without a resume timer
// - `Downloader.quota`        the download quota is used up
import type { IssueAction, IssueRule, RuleContext } from '../types.js';

export const DOWNLOADER_SOURCES = {
  connection: 'Downloader.connection',
  trackerError: 'Downloader.trackerError',
  paused: 'Downloader.paused',
  quota: 'Downloader.quota',
} as const;

function openInstance(ctx: RuleContext, instance: { id: string; name: string }): IssueAction[] {
  const href = ctx.webUrl(instance.id);
  return href
    ? [
        {
          id: 'open-instance',
          kind: 'openLink',
          class: 'safe',
          label: { key: 'issues.action.openInstance', params: { name: instance.name } },
          href,
        },
      ]
    : [];
}

/** The client has no network connection at all, usually because its VPN is down. */
export const downloaderOffline: IssueRule<Record<string, never>> = {
  id: 'downloader-offline',
  detect(signal) {
    if (signal.kind !== 'health' || signal.source !== DOWNLOADER_SOURCES.connection) return null;
    if (signal.data?.status !== 'disconnected') return null;
    return [{ key: signal.instance.id, params: {} }];
  },
  build(matches, ctx) {
    const instance = matches[0]!.signal.instance;
    return {
      severity: 'critical',
      title: { key: 'issues.downloaderOffline.title', params: { instance: instance.name } },
      affected: { key: 'issues.common.instances', params: { instances: instance.name } },
      explanation: { key: 'issues.downloaderOffline.explanation', params: { instance: instance.name } },
      fix: { key: 'issues.downloaderOffline.fix' },
      actions: openInstance(ctx, instance),
    };
  },
};

/** Peers cannot connect to the client: the listening port is closed. */
export const downloaderPortClosed: IssueRule<Record<string, never>> = {
  id: 'downloader-port-closed',
  detect(signal) {
    if (signal.kind !== 'health' || signal.source !== DOWNLOADER_SOURCES.connection) return null;
    if (signal.data?.status !== 'firewalled') return null;
    return [{ key: signal.instance.id, params: {} }];
  },
  build(matches, ctx) {
    const instance = matches[0]!.signal.instance;
    return {
      severity: 'warning',
      title: { key: 'issues.downloaderPortClosed.title', params: { instance: instance.name } },
      affected: { key: 'issues.common.instances', params: { instances: instance.name } },
      explanation: { key: 'issues.downloaderPortClosed.explanation' },
      fix: { key: 'issues.downloaderPortClosed.fix' },
      actions: openInstance(ctx, instance),
    };
  },
};

interface TrackerParams {
  name: string;
  reason: string;
}

/** Torrents whose tracker answers with an error, grouped per client. */
export const trackerErrors: IssueRule<TrackerParams> = {
  id: 'tracker-errors',
  detect(signal) {
    if (signal.kind !== 'health' || signal.source !== DOWNLOADER_SOURCES.trackerError) return null;
    const name = typeof signal.data?.name === 'string' ? signal.data.name : signal.message;
    const reason = typeof signal.data?.reason === 'string' ? signal.data.reason : '';
    return [{ key: signal.instance.id, params: { name, reason } }];
  },
  build(matches, ctx) {
    const instance = matches[0]!.signal.instance;
    const unique = new Map<string, TrackerParams>();
    for (const m of matches) if (!unique.has(m.params.name)) unique.set(m.params.name, m.params);
    const count = unique.size;
    const unregistered = [...unique.values()].some((p) =>
      /unregistered|not registered|not found/i.test(p.reason),
    );
    return {
      severity: 'warning',
      title: { key: 'issues.trackerErrors.title', params: { count, instance: instance.name } },
      affected: { key: 'issues.trackerErrors.affected', params: { count } },
      explanation: {
        key: unregistered
          ? 'issues.trackerErrors.explanationUnregistered'
          : 'issues.trackerErrors.explanation',
      },
      fix: { key: 'issues.trackerErrors.fix', params: { instance: instance.name } },
      items: [...unique.values()].map((p) => ({
        label: p.name,
        instanceId: instance.id,
        ...(p.reason ? { info: { key: 'issues.trackerErrors.reason', params: { reason: p.reason } } } : {}),
      })),
      actions: openInstance(ctx, instance),
    };
  },
};

/** Downloads are paused with no timer, so nothing new arrives. */
export const downloaderPaused: IssueRule<Record<string, never>> = {
  id: 'downloader-paused',
  detect(signal) {
    if (signal.kind !== 'health' || signal.source !== DOWNLOADER_SOURCES.paused) return null;
    return [{ key: signal.instance.id, params: {} }];
  },
  build(matches, ctx) {
    const instance = matches[0]!.signal.instance;
    return {
      severity: 'info',
      title: { key: 'issues.downloaderPaused.title', params: { instance: instance.name } },
      affected: { key: 'issues.common.instances', params: { instances: instance.name } },
      explanation: { key: 'issues.downloaderPaused.explanation' },
      fix: { key: 'issues.downloaderPaused.fix', params: { instance: instance.name } },
      actions: openInstance(ctx, instance),
    };
  },
};

/** The download quota of a Usenet client is used up. */
export const downloaderQuota: IssueRule<Record<string, never>> = {
  id: 'downloader-quota',
  detect(signal) {
    if (signal.kind !== 'health' || signal.source !== DOWNLOADER_SOURCES.quota) return null;
    return [{ key: signal.instance.id, params: {} }];
  },
  build(matches, ctx) {
    const instance = matches[0]!.signal.instance;
    return {
      severity: 'warning',
      title: { key: 'issues.downloaderQuota.title', params: { instance: instance.name } },
      affected: { key: 'issues.common.instances', params: { instances: instance.name } },
      explanation: { key: 'issues.downloaderQuota.explanation' },
      fix: { key: 'issues.downloaderQuota.fix' },
      actions: openInstance(ctx, instance),
    };
  },
};
