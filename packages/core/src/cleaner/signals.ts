// Turns a cleaner plan into issue signals. They use the `cleaner` channel,
// so their issues resolve only after the cleaner ran again.
import type { DownloadJob } from '../adapter/types.js';
import type { InstanceRef, Signal } from '../issues/types.js';
import type { CleanerPlan } from './types.js';

export const CLEANER_CHANNEL = 'cleaner';

export function cleanerSignals(plan: CleanerPlan, instance: InstanceRef): Signal[] {
  const out: Signal[] = [];
  if (plan.paused) {
    out.push({
      origin: 'service',
      instance,
      kind: 'cleaner',
      source: 'QueueCleaner.paused',
      level: 'error',
      message: plan.paused.message,
      data: { reason: plan.paused.kind },
      channel: CLEANER_CHANNEL,
    });
  }
  for (const d of plan.downloads) {
    if (d.rule !== 'importReady') continue;
    out.push({
      origin: 'service',
      instance,
      kind: 'cleaner',
      source: 'QueueCleaner.importReady',
      level: 'warning',
      message: d.title,
      data: { downloadKey: d.key, title: d.title, waitUntil: d.waitUntil ?? '' },
      channel: CLEANER_CHANNEL,
    });
  }
  for (const a of plan.exhausted) {
    out.push({
      origin: 'service',
      instance,
      kind: 'cleaner',
      source: 'QueueCleaner.exhausted',
      level: 'warning',
      message: a.title,
      data: { titleKey: a.titleKey, title: a.title, attempts: a.attempts },
      channel: CLEANER_CHANNEL,
    });
  }
  return out;
}

export function orphanSignals(orphans: DownloadJob[], client: InstanceRef): Signal[] {
  return orphans.map((j) => ({
    origin: 'service',
    instance: client,
    kind: 'cleaner',
    source: 'QueueCleaner.orphan',
    level: 'warning',
    message: j.name,
    data: { jobId: j.id, name: j.name, state: j.state },
    channel: CLEANER_CHANNEL,
  }));
}
