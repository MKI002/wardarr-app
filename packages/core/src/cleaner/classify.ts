// Pure helpers: merge queue records into downloads, detect infrastructure
// problems, and judge import previews.
import type { DownloadJob, ImportPreviewFile, QueueItem, SearchTarget } from '../adapter/types.js';
import type { Signal } from '../issues/types.js';
import type { CleanerDownload, InfraProblem } from './types.js';

const lower = (s: string) => s.toLowerCase();

/** The key of a download: shared by all records of a season pack. */
export function downloadKey(item: Pick<QueueItem, 'downloadId' | 'id'>): string {
  return item.downloadId ? lower(item.downloadId) : `queue:${item.id}`;
}

function mergeTargets(items: QueueItem[]): { target: SearchTarget | null; titleKey: string | null } {
  const targets = items.map((i) => i.searchTarget).filter((t): t is SearchTarget => !!t);
  if (targets.length === 0) return { target: null, titleKey: items[0]?.titleKey ?? null };
  if (targets.length === 1)
    return { target: targets[0]!, titleKey: items.find((i) => i.titleKey)?.titleKey ?? null };
  const first = items[0]!;
  const allEpisodes = targets.every((t) => t.kind === 'episodes');
  const sameSeason = items.every(
    (i) => i.parentId === first.parentId && i.seasonNumber === first.seasonNumber,
  );
  if (allEpisodes && sameSeason && first.parentId !== undefined && first.seasonNumber !== undefined) {
    const episodeIds = targets.flatMap((t) => (t.kind === 'episodes' ? t.ids : []));
    return {
      target: { kind: 'season', seriesId: first.parentId, seasonNumber: first.seasonNumber, episodeIds },
      titleKey: `season:${first.parentId}:${first.seasonNumber}`,
    };
  }
  const kind = targets[0]!.kind;
  if (kind !== 'season' && targets.every((t) => t.kind === kind)) {
    const ids = [...new Set(targets.flatMap((t) => ('ids' in t ? t.ids : [])))];
    return {
      target: { kind, ids } as SearchTarget,
      titleKey: items.find((i) => i.titleKey)?.titleKey ?? null,
    };
  }
  return { target: targets[0]!, titleKey: items.find((i) => i.titleKey)?.titleKey ?? null };
}

/**
 * Merges queue records that share a download id (season packs) and adds the
 * download client view (speed, state, tags) when the job is known there.
 */
export function buildDownloads(queue: QueueItem[], jobs: DownloadJob[] = []): CleanerDownload[] {
  const groups = new Map<string, QueueItem[]>();
  for (const item of queue) {
    const key = downloadKey(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const jobById = new Map(jobs.map((j) => [lower(j.id), j]));
  return [...groups.entries()].map(([key, items]) => {
    const first = items[0]!;
    const job = first.downloadId ? jobById.get(lower(first.downloadId)) : undefined;
    const { target, titleKey } = mergeTargets(items);
    const messages = [
      ...new Set(items.flatMap((i) => [...i.statusMessages, ...(i.errorMessage ? [i.errorMessage] : [])])),
    ];
    return {
      key,
      downloadId: first.downloadId,
      queueIds: items.map((i) => i.id),
      title: first.title,
      state: worstState(items),
      matched: items.some((i) => i.matched),
      messages,
      inLibrary: items.every((i) => i.inLibrary === true)
        ? true
        : items.some((i) => i.inLibrary === false)
          ? false
          : undefined,
      tags: [...new Set([...items.flatMap((i) => i.tags ?? []), ...(job?.tags ?? [])])],
      titleKey,
      searchTarget: target,
      sizeLeftBytes: first.sizeLeftBytes ?? null,
      speedBytesPerSecond: job?.speedBytesPerSecond ?? null,
      clientState: job?.state ?? null,
    };
  });
}

const STATE_ORDER: QueueItem['state'][] = [
  'failed',
  'importBlocked',
  'warning',
  'importPending',
  'downloading',
  'paused',
  'queued',
  'completed',
  'unknown',
];

function worstState(items: QueueItem[]): QueueItem['state'] {
  return [...items].sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state))[0]!.state;
}

const INFRA_MESSAGES: Array<[InfraProblem['kind'], RegExp]> = [
  [
    'diskFull',
    /not enough (free )?(disk )?space|disk (is )?full|no space left|insufficient (free )?(disk )?space/i,
  ],
  [
    'permissions',
    /access to the path .* is denied|permission denied|unauthorizedaccess|read-only file system/i,
  ],
  ['rootFolderMissing', /root folder .*(missing|does not exist|is not available|not found)/i],
  [
    'clientUnreachable',
    /download client .*(unavailable|unreachable)|unable to communicate with|unable to connect to (the )?download client/i,
  ],
  [
    'pathMissing',
    /(path|folder|directory) .*(does not exist|not found|is missing|was not found)|could not find (the )?(file|path|folder)/i,
  ],
];

const INFRA_HEALTH: Record<string, InfraProblem['kind']> = {
  RootFolderCheck: 'rootFolderMissing',
  DownloadClientCheck: 'clientUnreachable',
  DownloadClientStatusCheck: 'clientUnreachable',
  DownloadClientRootFolderCheck: 'pathMissing',
  RemotePathMappingCheck: 'pathMissing',
};

/** Finds a problem of the setup that makes every decision unreliable. */
export function detectInfrastructure(
  downloads: CleanerDownload[],
  health: Signal[] = [],
): InfraProblem | null {
  for (const s of health) {
    const kind = s.source ? INFRA_HEALTH[s.source] : undefined;
    if (kind && (s.level === 'error' || s.level === 'warning')) return { kind, message: s.message };
  }
  for (const d of downloads) {
    for (const m of d.messages) {
      for (const [kind, pattern] of INFRA_MESSAGES) if (pattern.test(m)) return { kind, message: m };
    }
  }
  return null;
}

export function isTba(d: CleanerDownload): boolean {
  return (
    (d.state === 'importBlocked' || d.state === 'importPending' || d.state === 'warning') &&
    d.messages.some((m) => /\bTBA\b/.test(m))
  );
}

/** A preview is clean when every file has a target and nothing is rejected. */
export function isCleanPreview(files: ImportPreviewFile[] | null | undefined): boolean {
  return !!files && files.length > 0 && files.every((f) => f.target !== null && f.rejections.length === 0);
}

/**
 * Download client jobs that no *arr queue knows. Seeding and completed jobs
 * are skipped, because *arr apps forget downloads after importing them.
 */
export function findOrphans(
  jobs: DownloadJob[],
  knownDownloadIds: Iterable<string>,
  opts: { now: Date; minAgeMinutes: number } = { now: new Date(), minAgeMinutes: 60 },
): DownloadJob[] {
  const known = new Set([...knownDownloadIds].map(lower));
  const cutoff = opts.now.getTime() - opts.minAgeMinutes * 60_000;
  return jobs.filter(
    (j) =>
      !known.has(lower(j.id)) &&
      !['seeding', 'completed', 'unknown'].includes(j.state) &&
      // Jobs without a timestamp count as old enough.
      (!j.addedAt || new Date(j.addedAt).getTime() <= cutoff),
  );
}
