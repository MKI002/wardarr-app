// Problems of transcode servers (Tdarr): nodes that went away, files that
// fail to transcode or check, and jobs that stopped moving. The signals come
// from Wardarr's transcode watcher, which remembers nodes and job progress.
import type { IssueAction, IssueRule, Msg, RuleContext } from '../types.js';

/** Signal sources of the transcode watcher. */
export const TRANSCODE_SOURCES = {
  nodeOffline: 'Tdarr.nodeOffline',
  noNodes: 'Tdarr.noNodes',
  failedFiles: 'Tdarr.failedFiles',
  stuckJobs: 'Tdarr.stuckJob',
} as const;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);

function actions(instanceId: string, instanceName: string, ctx: RuleContext): IssueAction[] {
  const out: IssueAction[] = [
    {
      id: 'open-transcoding',
      kind: 'openWardarr',
      class: 'safe',
      label: { key: 'issues.action.openTdarr' },
      href: `/tdarr?instance=${encodeURIComponent(instanceId)}`,
    },
  ];
  const href = ctx.webUrl(instanceId, { kind: 'system' });
  if (href)
    out.push({
      id: 'open-instance',
      kind: 'openLink',
      class: 'safe',
      label: { key: 'issues.action.openInstance', params: { name: instanceName } },
      href,
    });
  return out;
}

interface NodeParams {
  node: string;
  lastSeenAt: string;
}

/** A node Wardarr saw before is no longer connected to its server. */
export const transcodeNodeOffline: IssueRule<NodeParams> = {
  id: 'transcode-node-offline',
  detect(signal) {
    if (signal.kind !== 'health' || signal.source !== TRANSCODE_SOURCES.nodeOffline) return null;
    const node = str(signal.data?.node) || signal.message;
    const id = str(signal.data?.nodeId) || node;
    return [
      { key: `${signal.instance.id}:${id}`, params: { node, lastSeenAt: str(signal.data?.lastSeenAt) } },
    ];
  },
  build(matches, ctx) {
    const { node } = matches[0]!.params;
    const instance = matches[0]!.signal.instance;
    return {
      severity: 'warning',
      title: { key: 'issues.transcodeNodeOffline.title', params: { node, instance: instance.name } },
      affected: { key: 'issues.common.instances', params: { instances: instance.name } },
      explanation: {
        key: 'issues.transcodeNodeOffline.explanation',
        params: { node, instance: instance.name },
      },
      fix: { key: 'issues.transcodeNodeOffline.fix', params: { node } },
      actions: actions(instance.id, instance.name, ctx),
    };
  },
};

/** A server without any node does no work at all. */
export const transcodeNoNodes: IssueRule<Record<string, never>> = {
  id: 'transcode-no-nodes',
  detect(signal) {
    if (signal.kind !== 'health' || signal.source !== TRANSCODE_SOURCES.noNodes) return null;
    return [{ key: signal.instance.id, params: {} }];
  },
  build(matches, ctx) {
    const instance = matches[0]!.signal.instance;
    return {
      severity: 'warning',
      title: { key: 'issues.transcodeNoNodes.title', params: { instance: instance.name } },
      affected: { key: 'issues.common.instances', params: { instances: instance.name } },
      explanation: { key: 'issues.transcodeNoNodes.explanation', params: { instance: instance.name } },
      fix: { key: 'issues.transcodeNoNodes.fix' },
      actions: actions(instance.id, instance.name, ctx),
    };
  },
};

interface FailedParams {
  transcode: number;
  healthCheck: number;
  /** Failures added today. */
  recent: number;
}

/**
 * Files that failed to transcode or failed their health check. Many new
 * failures in a short time usually mean a broken plugin, flow or node.
 */
export const transcodeFailures: IssueRule<FailedParams> = {
  id: 'transcode-failures',
  detect(signal) {
    if (signal.kind !== 'health' || signal.source !== TRANSCODE_SOURCES.failedFiles) return null;
    return [
      {
        key: signal.instance.id,
        params: {
          transcode: int(signal.data?.transcode),
          healthCheck: int(signal.data?.healthCheck),
          recent: int(signal.data?.recent),
        },
      },
    ];
  },
  build(matches, ctx) {
    const instance = matches[0]!.signal.instance;
    const { transcode, healthCheck, recent } = matches[0]!.params;
    const count = transcode + healthCheck;
    const affected: Msg =
      transcode && healthCheck
        ? { key: 'issues.transcodeFailures.affectedBoth', params: { transcode, healthCheck } }
        : transcode
          ? { key: 'issues.transcodeFailures.affectedTranscode', params: { count: transcode } }
          : { key: 'issues.transcodeFailures.affectedHealthCheck', params: { count: healthCheck } };
    return {
      severity: recent >= 10 ? 'critical' : 'warning',
      title: {
        key: recent >= 10 ? 'issues.transcodeFailures.titleBurst' : 'issues.transcodeFailures.title',
        params: { count: recent >= 10 ? recent : count, instance: instance.name },
      },
      affected,
      explanation: {
        key: healthCheck
          ? 'issues.transcodeFailures.explanationHealth'
          : 'issues.transcodeFailures.explanation',
      },
      fix: { key: 'issues.transcodeFailures.fix' },
      actions: actions(instance.id, instance.name, ctx),
    };
  },
};

interface StuckParams {
  file: string;
  node: string;
  minutes: number;
  jobKey: string;
}

/** Jobs whose progress has not moved for a long time, grouped per server. */
export const transcodeStuck: IssueRule<StuckParams> = {
  id: 'transcode-stuck',
  detect(signal) {
    if (signal.kind !== 'health' || signal.source !== TRANSCODE_SOURCES.stuckJobs) return null;
    const file = str(signal.data?.file) || signal.message;
    return [
      {
        key: signal.instance.id,
        params: {
          file,
          node: str(signal.data?.node),
          minutes: int(signal.data?.minutes),
          jobKey: str(signal.data?.jobKey) || file,
        },
      },
    ];
  },
  build(matches, ctx) {
    const instance = matches[0]!.signal.instance;
    const jobs = new Map<string, StuckParams>();
    for (const m of matches) jobs.set(m.params.jobKey, m.params);
    const list = [...jobs.values()].sort((a, b) => b.minutes - a.minutes);
    const count = list.length;
    const name = (file: string) => file.split(/[\\/]/).pop() || file;
    return {
      severity: 'warning',
      title: { key: 'issues.transcodeStuck.title', params: { count, instance: instance.name } },
      affected: {
        key: 'issues.transcodeStuck.affected',
        params: { count, minutes: list[0]?.minutes ?? 0 },
      },
      explanation: { key: 'issues.transcodeStuck.explanation' },
      fix: { key: 'issues.transcodeStuck.fix' },
      items: list.map((j) => ({
        label: name(j.file),
        instanceId: instance.id,
        info: { key: 'issues.transcodeStuck.item', params: { node: j.node, minutes: j.minutes } },
      })),
      actions: actions(instance.id, instance.name, ctx),
    };
  },
};
