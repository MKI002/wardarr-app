// The Queue Cleaner's decision per download. The first matching rule wins:
//
// 1. protected  - ignored, protection tag or whitelist: never touched
// 2. paused     - infrastructure problem: the whole instance waits, no strikes
// 3. TBA        - waits without strikes up to tbaMaxWaitHours, then rule 5
// 4. importable - clean import preview: waits for "Review import", then rule 5
// 5. strikes    - other blocked imports, failed and stalled downloads
// 6. slow       - collects strikes only when enabled
//
// Strikes are added at most once per strikeIntervalMinutes and reset when the
// problem disappears. After the last strike the download is removed; titles
// that are missing are blocklisted and searched again, up to attemptsPerTitle.
import type { Msg } from '../issues/types.js';
import { isCleanPreview, isTba } from './classify.js';
import {
  STRIKE_RULES,
  type CleanerAction,
  type CleanerDownload,
  type CleanerInput,
  type CleanerPlan,
  type CleanerRule,
  type DownloadState,
  type PlannedDownload,
  type TitleAttempts,
} from './types.js';

const HOUR = 3_600_000;
const MINUTE = 60_000;

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: string | null | undefined) => (s ? new Date(s).getTime() : NaN);

function isProtected(d: CleanerDownload, input: CleanerInput): boolean {
  const tags = new Set(input.config.protectedTags.map((t) => t.toLowerCase()));
  if (d.tags.some((t) => tags.has(t.toLowerCase()))) return true;
  const hay = `${d.title}\n${d.downloadId ?? ''}`.toLowerCase();
  return input.config.whitelist.some((w) => w.trim() && hay.includes(w.trim().toLowerCase()));
}

interface Judgement {
  rule: CleanerRule;
  waitUntil: number | null;
}

/** Applies rules 3 to 6. Rules 1 and 2 are handled by the caller. */
function judge(
  d: CleanerDownload,
  prev: DownloadState | undefined,
  lastProgressAt: number,
  input: CleanerInput,
): Judgement {
  const { config } = input;
  const now = input.now.getTime();
  const since = (rule: CleanerRule[]) =>
    prev?.problem && rule.includes(prev.problem) && prev.problemSince ? ms(prev.problemSince) : now;

  if (isTba(d)) {
    const start = since(['tbaWaiting', 'tbaExpired']);
    const until = start + config.tbaMaxWaitHours * HOUR;
    return now < until ? { rule: 'tbaWaiting', waitUntil: until } : { rule: 'tbaExpired', waitUntil: null };
  }

  if (d.state === 'importBlocked' || d.state === 'importPending') {
    const preview = input.previews.get(d.key);
    if (d.state === 'importBlocked' && isCleanPreview(preview)) {
      if (!config.waitForImportClick) return { rule: 'importBlocked', waitUntil: null };
      const start = since(['importReady', 'importReadyExpired']);
      const until = start + config.importClickMaxHours * HOUR;
      return now < until
        ? { rule: 'importReady', waitUntil: until }
        : { rule: 'importReadyExpired', waitUntil: null };
    }
    // Import pending without a block is normal and resolves on its own.
    if (d.state === 'importPending') return { rule: 'healthy', waitUntil: null };
    return { rule: 'importBlocked', waitUntil: null };
  }

  if (d.state === 'failed') return { rule: config.failedEnabled ? 'failed' : 'healthy', waitUntil: null };

  const active = d.state === 'downloading' || d.state === 'warning';
  if (active && now - lastProgressAt >= config.stalledAfterHours * HOUR)
    return { rule: 'stalled', waitUntil: null };

  if (
    config.slowEnabled &&
    d.state === 'downloading' &&
    d.speedBytesPerSecond !== null &&
    d.speedBytesPerSecond < config.slowMinBytesPerSecond
  )
    return { rule: 'slow', waitUntil: null };

  return { rule: 'healthy', waitUntil: null };
}

function reasonFor(rule: string, p: Record<string, string | number>): Msg {
  return { key: `cleaner.reason.${rule}`, params: p };
}

export function planCleanerRun(input: CleanerInput): CleanerPlan {
  const { config } = input;
  const now = input.now.getTime();
  const nowIso = iso(now);
  const attempts = new Map(input.attempts);
  const exhausted = new Map<string, TitleAttempts>();
  const nextState: DownloadState[] = [];
  const planned: PlannedDownload[] = [];
  let removals = 0;

  for (const d of input.downloads) {
    const prev = input.state.get(d.key);
    // Progress tracking for stalled detection.
    const progressed =
      prev?.lastSizeLeft !== null &&
      prev?.lastSizeLeft !== undefined &&
      d.sizeLeftBytes !== null &&
      d.sizeLeftBytes < prev.lastSizeLeft;
    const lastProgressAt = !prev || progressed ? now : ms(prev.lastProgressAt);
    const base: DownloadState = {
      key: d.key,
      title: d.title,
      firstSeenAt: prev?.firstSeenAt ?? nowIso,
      problem: prev?.problem ?? null,
      problemSince: prev?.problemSince ?? null,
      strikes: prev?.strikes ?? 0,
      lastStrikeAt: prev?.lastStrikeAt ?? null,
      lastProgressAt: iso(lastProgressAt),
      lastSizeLeft: d.sizeLeftBytes,
      ignored: prev?.ignored ?? false,
    };
    const entry = (
      rule: CleanerRule,
      action: CleanerAction,
      reason: Msg,
      waitUntil: number | null,
      st: DownloadState,
    ): PlannedDownload => ({
      key: d.key,
      title: d.title,
      downloadId: d.downloadId,
      queueIds: d.queueIds,
      matched: d.matched,
      state: d.state,
      rule,
      strikes: st.strikes,
      maxStrikes: config.maxStrikes,
      nextStrikeAt:
        STRIKE_RULES.has(rule) && st.strikes < config.maxStrikes && st.lastStrikeAt
          ? iso(ms(st.lastStrikeAt) + config.strikeIntervalMinutes * MINUTE)
          : null,
      waitUntil: waitUntil === null ? null : iso(waitUntil),
      action,
      reason,
    });

    // Rule 1: protected.
    if (base.ignored || isProtected(d, input)) {
      const rule: CleanerRule = base.ignored ? 'ignored' : 'protected';
      nextState.push(base);
      planned.push(entry(rule, { type: 'none' }, reasonFor(rule, {}), null, base));
      continue;
    }

    // Rule 2: infrastructure problem pauses the instance. Strikes stay as they are.
    if (input.infra) {
      nextState.push(base);
      planned.push(
        entry('paused', { type: 'none' }, reasonFor('paused', { kind: input.infra.kind }), null, base),
      );
      continue;
    }

    const { rule, waitUntil } = judge(d, prev, lastProgressAt, input);

    if (rule === 'healthy') {
      // The problem is gone: strikes reset.
      const st: DownloadState = {
        ...base,
        problem: null,
        problemSince: null,
        strikes: 0,
        lastStrikeAt: null,
      };
      nextState.push(st);
      planned.push(entry('healthy', { type: 'none' }, reasonFor('healthy', {}), null, st));
      continue;
    }

    const sameFamily = (a: CleanerRule | null, b: CleanerRule) =>
      a === b ||
      (a?.startsWith('tba') && b.startsWith('tba')) ||
      (a?.startsWith('importReady') && b.startsWith('importReady'));
    const problemSince =
      prev?.problem && sameFamily(prev.problem, rule) && prev.problemSince ? prev.problemSince : nowIso;

    if (!STRIKE_RULES.has(rule)) {
      // Waiting rules (TBA, importable): no strikes.
      const st: DownloadState = { ...base, problem: rule, problemSince };
      nextState.push(st);
      planned.push(entry(rule, { type: 'none' }, reasonFor(rule, {}), waitUntil, st));
      continue;
    }

    // Strike rules.
    let st: DownloadState = { ...base, problem: rule, problemSince };
    const due = !st.lastStrikeAt || now - ms(st.lastStrikeAt) >= config.strikeIntervalMinutes * MINUTE;
    let action: CleanerAction = { type: 'none' };
    if (due && st.strikes < config.maxStrikes) {
      st = { ...st, strikes: st.strikes + 1, lastStrikeAt: nowIso };
      action = { type: 'strike' };
    }

    if (st.strikes >= config.maxStrikes) {
      if (removals >= config.maxRemovalsPerRun) {
        nextState.push(st);
        planned.push(
          entry(
            rule,
            { type: 'deferred' },
            reasonFor('deferred', { limit: config.maxRemovalsPerRun }),
            null,
            st,
          ),
        );
        continue;
      }
      removals++;
      const queueId = d.queueIds[0]!;
      if (d.inLibrary === true) {
        // Already in the library: remove only, no blocklist, no new search.
        action = { type: 'remove', queueId, blocklist: false, search: null, exhausted: false };
        planned.push(entry(rule, action, reasonFor('removeInLibrary', { strikes: st.strikes }), null, st));
      } else if (!d.titleKey || !d.searchTarget) {
        // Unmatched: nothing to search for.
        action = { type: 'remove', queueId, blocklist: true, search: null, exhausted: false };
        planned.push(entry(rule, action, reasonFor('removeUnmatched', { strikes: st.strikes }), null, st));
      } else {
        const a = attempts.get(d.titleKey) ?? {
          titleKey: d.titleKey,
          title: d.title,
          attempts: 0,
          lastAttemptAt: null,
        };
        if (a.attempts >= config.attemptsPerTitle) {
          action = { type: 'remove', queueId, blocklist: true, search: null, exhausted: true };
          exhausted.set(a.titleKey, a);
          planned.push(entry(rule, action, reasonFor('removeExhausted', { attempts: a.attempts }), null, st));
        } else {
          const next = { ...a, title: d.title, attempts: a.attempts + 1, lastAttemptAt: nowIso };
          // A dry run never uses up attempts.
          if (!input.dryRun) attempts.set(d.titleKey, next);
          action = { type: 'remove', queueId, blocklist: true, search: d.searchTarget, exhausted: false };
          planned.push(
            entry(
              rule,
              action,
              reasonFor('removeSearch', { attempt: next.attempts, max: config.attemptsPerTitle }),
              null,
              st,
            ),
          );
        }
      }
      // Removed downloads leave the queue; their state is dropped. In a dry
      // run the download stays, so its state is kept at the maximum.
      if (input.dryRun) nextState.push(st);
      continue;
    }

    nextState.push(st);
    planned.push(
      entry(rule, action, reasonFor(rule, { strikes: st.strikes, max: config.maxStrikes }), null, st),
    );
  }

  // Titles that already used up their attempts stay exhausted until reset.
  for (const a of attempts.values()) if (a.attempts >= config.attemptsPerTitle) exhausted.set(a.titleKey, a);

  return {
    paused: input.infra,
    downloads: planned,
    nextState,
    nextAttempts: [...attempts.values()],
    exhausted: [...exhausted.values()],
    removals,
  };
}
