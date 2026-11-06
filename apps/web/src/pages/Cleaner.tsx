// Queue Cleaner: every download with its rule, strikes and next step, a
// preview of the next run, the history, and the settings per instance.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { Msg } from '@wardarr/core';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import {
  Badge,
  Button,
  Card,
  Disclosure,
  EmptyState,
  InlineError,
  NumberField,
  Skeleton,
  StrikeMeter,
  Tabs,
  TextField,
  Toggle,
  spring,
  type Tone,
} from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatRelative } from '../lib/format';
import { tm } from '../lib/i18n';

export interface CleanerConfig {
  enabled: boolean;
  dryRun: boolean;
  maxStrikes: number;
  strikeIntervalMinutes: number;
  checkIntervalMinutes: number;
  tbaMaxWaitHours: number;
  waitForImportClick: boolean;
  importClickMaxHours: number;
  attemptsPerTitle: number;
  stalledAfterHours: number;
  failedEnabled: boolean;
  slowEnabled: boolean;
  slowMinBytesPerSecond: number;
  maxRemovalsPerRun: number;
  protectedTags: string[];
  whitelist: string[];
}

interface PlannedDownload {
  key: string;
  title: string;
  downloadId: string | null;
  matched: boolean;
  state: string;
  rule: string;
  strikes: number;
  maxStrikes: number;
  nextStrikeAt: string | null;
  waitUntil: string | null;
  action:
    | { type: 'none' | 'strike' | 'deferred' }
    | { type: 'remove'; blocklist: boolean; search: unknown; exhausted: boolean };
  reason: Msg;
}

interface CleanerInstance {
  instanceId: string;
  instanceName: string;
  adapterName: string;
  config: CleanerConfig;
  lastRunAt: string | null;
  nextRunAt: string | null;
  error: string | null;
  paused: { kind: string; message: string } | null;
  downloads: PlannedDownload[];
  exhausted: Array<{ titleKey: string; title: string; attempts: number; lastAttemptAt: string | null }>;
}

interface Orphan {
  id: string;
  name: string;
  state: string;
  clientId: string;
  clientName: string;
  sizeBytes: number | null;
}

interface HistoryEntry {
  id: number;
  at: string;
  title: string;
  kind: string;
  rule: string;
  reason: Msg;
  dryRun: boolean;
  ok: boolean;
}

interface PreviewFile {
  path: string;
  name: string;
  target: string | null;
  rejections: string[];
}

type Tab = 'downloads' | 'preview' | 'history' | 'attempts' | 'orphans' | 'settings';
const TABS: Tab[] = ['downloads', 'preview', 'history', 'attempts', 'orphans', 'settings'];

const RULE_TONE: Record<string, Tone> = {
  failed: 'critical',
  stalled: 'warning',
  slow: 'warning',
  importBlocked: 'warning',
  importReadyExpired: 'warning',
  tbaExpired: 'warning',
  importReady: 'info',
  tbaWaiting: 'info',
  paused: 'critical',
  protected: 'neutral',
  ignored: 'neutral',
  healthy: 'ok',
};

const KIND_TONE: Record<string, Tone> = {
  strike: 'warning',
  remove: 'info',
  removeBlocklist: 'critical',
  search: 'info',
  deferred: 'neutral',
  import: 'ok',
  armed: 'critical',
  disarmed: 'ok',
};

function useCleaner() {
  return useQuery({
    queryKey: ['cleaner'],
    queryFn: () => api<{ instances: CleanerInstance[]; orphans: Orphan[] }>('/api/cleaner'),
    refetchInterval: 30_000,
  });
}

const enc = encodeURIComponent;

function useCleanerAction<T>(instanceId: string, path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: T) => api(`/api/cleaner/${enc(instanceId)}${path}`, { method: 'POST', body }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['cleaner'] });
      void qc.invalidateQueries({ queryKey: ['cleaner-history'] });
      void qc.invalidateQueries({ queryKey: ['cleaner-preview'] });
    },
  });
}

// ----------------------------------------------------------------- page

export function CleanerPage() {
  const { t } = useTranslation();
  const search = useSearch({ from: '/cleaner' });
  const navigate = useNavigate({ from: '/cleaner' });
  const data = useCleaner();
  const instances = data.data?.instances ?? [];
  const current = instances.find((i) => i.instanceId === search.instance) ?? instances[0];
  const tab: Tab = search.tab ?? 'downloads';
  const setSearch = (s: Partial<typeof search>) => void navigate({ search: { ...search, ...s } });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('ui.cleaner.title')}</h1>
          <p className="text-sm text-muted">{t('ui.cleaner.subtitle')}</p>
        </div>
        {instances.length > 1 ? (
          <select
            aria-label={t('ui.cleaner.instance')}
            className="min-h-9 rounded-lg border border-border bg-surface px-3 text-sm"
            value={current?.instanceId ?? ''}
            onChange={(e) => setSearch({ instance: e.target.value, review: undefined })}
          >
            {instances.map((i) => (
              <option key={i.instanceId} value={i.instanceId}>
                {i.instanceName}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {data.isError ? (
        <InlineError message={t('ui.errors.loadFailed')} onRetry={() => void data.refetch()} />
      ) : null}
      {data.isPending ? <Skeleton className="h-64 rounded-[var(--radius-card)]" /> : null}
      {data.isSuccess && !current ? (
        <Card>
          <EmptyState title={t('ui.cleaner.noInstances')} body={t('ui.cleaner.noInstancesBody')} />
        </Card>
      ) : null}

      {current ? (
        <>
          <StatusCard inst={current} />
          <Tabs
            label={t('ui.cleaner.title')}
            value={tab}
            onChange={(v) => setSearch({ tab: v === 'downloads' ? undefined : v })}
            options={TABS.map((id) => [
              id,
              t(`ui.cleaner.tabs.${id}`),
              id === 'attempts'
                ? current.exhausted.length
                : id === 'orphans'
                  ? (data.data?.orphans.length ?? 0)
                  : id === 'downloads'
                    ? current.downloads.length
                    : undefined,
            ])}
          />
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${current.instanceId}:${tab}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {tab === 'downloads' ? (
                <Downloads
                  inst={current}
                  review={search.review}
                  onReview={(review) => setSearch({ review })}
                />
              ) : null}
              {tab === 'preview' ? <Preview inst={current} /> : null}
              {tab === 'history' ? <History instanceId={current.instanceId} /> : null}
              {tab === 'attempts' ? <Attempts inst={current} /> : null}
              {tab === 'orphans' ? (
                <Orphans orphans={data.data?.orphans ?? []} client={search.client} />
              ) : null}
              {tab === 'settings' ? <Settings key={current.instanceId} inst={current} /> : null}
            </motion.div>
          </AnimatePresence>
        </>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------- status card

function StatusCard({ inst }: { inst: CleanerInstance }) {
  const { t, i18n } = useTranslation();
  const [arming, setArming] = useState(false);
  const arm = useCleanerAction<{ confirm: true }>(inst.instanceId, '/arm');
  const disarm = useCleanerAction<Record<string, never>>(inst.instanceId, '/disarm');
  const run = useCleanerAction<Record<string, never>>(inst.instanceId, '/run');
  const dry = inst.config.dryRun;
  const counts = {
    strikes: inst.downloads.filter((d) => d.strikes > 0).length,
    waiting: inst.downloads.filter((d) => d.rule === 'tbaWaiting' || d.rule === 'importReady').length,
  };

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <motion.span layout transition={spring}>
          {!inst.config.enabled ? (
            <Badge tone="neutral">{t('ui.cleaner.mode.off')}</Badge>
          ) : dry ? (
            <Badge tone="info">{t('ui.cleaner.mode.dryRun')}</Badge>
          ) : (
            <Badge tone="critical">{t('ui.cleaner.mode.armed')}</Badge>
          )}
        </motion.span>
        <span className="font-semibold">{inst.instanceName}</span>
        <span className="text-sm text-muted">{inst.adapterName}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button onClick={() => run.mutate({})} busy={run.isPending}>
            {t('ui.cleaner.runNow')}
          </Button>
          {dry ? (
            <Button variant="danger" onClick={() => setArming(true)} disabled={!inst.config.enabled}>
              {t('ui.cleaner.arm')}
            </Button>
          ) : (
            <Button onClick={() => disarm.mutate({})} busy={disarm.isPending}>
              {t('ui.cleaner.disarm')}
            </Button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted">{dry ? t('ui.cleaner.dryRunHint') : t('ui.cleaner.armedHint')}</p>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>
          <span className="text-muted">{t('ui.cleaner.lastRun')}: </span>
          {inst.lastRunAt ? formatRelative(inst.lastRunAt, i18n.language) : t('ui.cleaner.never')}
        </span>
        <span>
          <span className="text-muted">{t('ui.cleaner.nextRun')}: </span>
          {inst.nextRunAt ? formatRelative(inst.nextRunAt, i18n.language) : '–'}
        </span>
        <span>
          <span className="text-muted">{t('ui.cleaner.withStrikes')}: </span>
          {counts.strikes}
        </span>
        <span>
          <span className="text-muted">{t('ui.cleaner.waiting')}: </span>
          {counts.waiting}
        </span>
      </div>
      {inst.paused ? (
        <div role="status" className="rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical">
          <strong>{t('ui.cleaner.paused', { reason: t(`cleaner.infra.${inst.paused.kind}`) })}</strong>{' '}
          <span className="text-text">{t(`issues.cleanerPaused.fix.${inst.paused.kind}`)}</span>
        </div>
      ) : null}
      {inst.error ? (
        <InlineError
          message={t('ui.cleaner.runFailed', {
            error: t(`ui.instance.testFailed.${inst.error}`, { defaultValue: inst.error }),
          })}
        />
      ) : null}
      {run.isError ? <InlineError {...errorText(t, run.error)} /> : null}

      <ConfirmDialog
        open={arming}
        onOpenChange={setArming}
        title={t('ui.cleaner.armTitle', { name: inst.instanceName })}
        body={t('ui.cleaner.armBody')}
        confirmLabel={t('ui.cleaner.armConfirm')}
        danger
        busy={arm.isPending}
        onConfirm={() => arm.mutate({ confirm: true }, { onSuccess: () => setArming(false) })}
      />
    </Card>
  );
}

// ------------------------------------------------------------- downloads

function DownloadRow({
  d,
  inst,
  onReview,
}: {
  d: PlannedDownload;
  inst: CleanerInstance;
  onReview: (key: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [removing, setRemoving] = useState(false);
  const [blocklist, setBlocklist] = useState(true);
  const [searchAgain, setSearchAgain] = useState(true);
  const remove = useCleanerAction<{ key: string; blocklist: boolean; search: boolean; confirm: true }>(
    inst.instanceId,
    '/downloads/remove',
  );
  const ignore = useCleanerAction<{ key: string; ignored: boolean }>(inst.instanceId, '/downloads/ignore');
  const reviewable = d.downloadId && ['importReady', 'importReadyExpired', 'importBlocked'].includes(d.rule);
  const when = d.waitUntil ?? d.nextStrikeAt;

  return (
    <motion.li layout transition={spring} className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={RULE_TONE[d.rule] ?? 'neutral'}>{t(`cleaner.rule.${d.rule}`)}</Badge>
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={d.title}>
          {d.title}
        </span>
        {!d.matched ? <Badge tone="warning">{t('ui.queue.unmatched')}</Badge> : null}
        {d.action.type === 'remove' ? <Badge tone="critical">{t('ui.cleaner.nextRemoves')}</Badge> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>{tm(t, d.reason)}</span>
        {d.strikes > 0 || d.rule in RULE_TONE ? (
          <span className="inline-flex items-center gap-1.5">
            <StrikeMeter
              strikes={d.strikes}
              max={d.maxStrikes}
              label={t('ui.cleaner.strikes', { strikes: d.strikes, max: d.maxStrikes })}
            />
            <span className="tabular-nums">
              {d.strikes}/{d.maxStrikes}
            </span>
          </span>
        ) : null}
        {when ? (
          <span>
            {d.waitUntil
              ? t('ui.cleaner.waitsUntil', { when: formatRelative(d.waitUntil, i18n.language) })
              : t('ui.cleaner.nextStrike', { when: formatRelative(when, i18n.language) })}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {reviewable ? (
          <Button
            variant={d.rule === 'importReady' ? 'primary' : 'secondary'}
            onClick={() => onReview(d.key)}
          >
            {t('issues.action.reviewImport')}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => setRemoving(true)}>
          {t('ui.cleaner.removeNow')}
        </Button>
        <Button
          variant="ghost"
          busy={ignore.isPending}
          onClick={() => ignore.mutate({ key: d.key, ignored: d.rule !== 'ignored' })}
        >
          {d.rule === 'ignored' ? t('ui.cleaner.unignore') : t('ui.cleaner.ignore')}
        </Button>
      </div>
      {remove.isError ? <InlineError {...errorText(t, remove.error)} /> : null}
      <Dialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('ui.cleaner.removeTitle')}
        description={d.title}
      >
        <div className="flex flex-col gap-4">
          <Toggle
            label={t('ui.cleaner.blocklist')}
            help={t('ui.cleaner.blocklistHelp')}
            checked={blocklist}
            onChange={setBlocklist}
          />
          <Toggle
            label={t('ui.cleaner.searchAgain')}
            help={t('ui.cleaner.searchAgainHelp')}
            checked={searchAgain && d.matched}
            disabled={!d.matched}
            onChange={setSearchAgain}
          />
          <p className="text-xs text-muted">{t('ui.cleaner.removeNote')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(false)}>
              {t('ui.common.cancel')}
            </Button>
            <Button
              variant="danger"
              busy={remove.isPending}
              onClick={() =>
                remove.mutate(
                  { key: d.key, blocklist, search: searchAgain && d.matched, confirm: true },
                  { onSuccess: () => setRemoving(false) },
                )
              }
            >
              {t('ui.cleaner.removeConfirm')}
            </Button>
          </div>
        </div>
      </Dialog>
    </motion.li>
  );
}

function Downloads({
  inst,
  review,
  onReview,
}: {
  inst: CleanerInstance;
  review?: string;
  onReview: (key: string | undefined) => void;
}) {
  const { t } = useTranslation();
  const order = (d: PlannedDownload) =>
    d.action.type === 'remove' ? 0 : d.strikes > 0 ? 1 : d.rule === 'healthy' ? 3 : 2;
  const list = [...inst.downloads].sort((a, b) => order(a) - order(b) || b.strikes - a.strikes);
  const reviewing = inst.downloads.find((d) => d.key === review);
  return (
    <Card>
      {list.length === 0 ? (
        <EmptyState title={t('ui.cleaner.emptyTitle')} body={t('ui.cleaner.emptyBody')} />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {list.map((d) => (
            <DownloadRow key={d.key} d={d} inst={inst} onReview={onReview} />
          ))}
        </ul>
      )}
      {reviewing ? <ReviewImport inst={inst} d={reviewing} onClose={() => onReview(undefined)} /> : null}
    </Card>
  );
}

function ReviewImport({
  inst,
  d,
  onClose,
}: {
  inst: CleanerInstance;
  d: PlannedDownload;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const preview = useQuery({
    queryKey: ['cleaner-import-preview', inst.instanceId, d.key],
    queryFn: () =>
      api<{ files: PreviewFile[] }>(`/api/cleaner/${enc(inst.instanceId)}/downloads/import-preview`, {
        method: 'POST',
        body: { key: d.key },
      }),
  });
  const importable = (preview.data?.files ?? []).filter((f) => f.target && f.rejections.length === 0);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const selected = chosen ?? new Set(importable.map((f) => f.path));
  const run = useCleanerAction<{ key: string; paths: string[]; confirm: true }>(
    inst.instanceId,
    '/downloads/import',
  );
  const toggle = (path: string) => {
    const next = new Set(selected);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setChosen(next);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('ui.cleaner.reviewTitle')}
      description={d.title}
      wide
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('ui.cleaner.reviewIntro')}</p>
        {preview.isPending ? <Skeleton className="h-24 rounded-lg" /> : null}
        {preview.isError ? (
          <InlineError {...errorText(t, preview.error)} onRetry={() => void preview.refetch()} />
        ) : null}
        {run.isSuccess ? (
          <div role="status" className="rounded-lg bg-ok-bg px-3 py-2 text-sm text-ok">
            {t('ui.cleaner.importStarted')}
          </div>
        ) : null}
        <ul className="flex flex-col gap-2">
          {(preview.data?.files ?? []).map((f) => {
            const ok = !!f.target && f.rejections.length === 0;
            return (
              <li key={f.path} className="rounded-lg border border-border p-3">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={!ok}
                    checked={ok && selected.has(f.path)}
                    onChange={() => toggle(f.path)}
                  />
                  <span className="flex min-w-0 flex-col gap-1 text-sm">
                    <span className="truncate font-medium" title={f.name}>
                      {f.name}
                    </span>
                    <span className="text-muted">→ {f.target ?? t('ui.cleaner.noTarget')}</span>
                    {f.rejections.map((r) => (
                      <span key={r} className="text-xs text-critical">
                        {r}
                      </span>
                    ))}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {run.isError ? <InlineError {...errorText(t, run.error)} /> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {run.isSuccess ? t('ui.common.close') : t('ui.common.cancel')}
          </Button>
          {!run.isSuccess ? (
            <Button
              variant="primary"
              disabled={selected.size === 0 || importable.length === 0}
              busy={run.isPending}
              onClick={() => run.mutate({ key: d.key, paths: [...selected], confirm: true })}
            >
              {t('ui.cleaner.importConfirm', {
                count: [...selected].filter((p) => importable.some((f) => f.path === p)).length,
              })}
            </Button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

// --------------------------------------------------------------- preview

function Preview({ inst }: { inst: CleanerInstance }) {
  const { t, i18n } = useTranslation();
  const preview = useQuery({
    queryKey: ['cleaner-preview', inst.instanceId],
    queryFn: () =>
      api<{ at: string | null; plan: { downloads: PlannedDownload[]; paused: unknown } | null }>(
        `/api/cleaner/${enc(inst.instanceId)}/preview`,
      ),
  });
  const actions = (preview.data?.plan?.downloads ?? []).filter((d) => d.action.type !== 'none');
  return (
    <Card className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        {preview.data?.at
          ? t('ui.cleaner.previewAt', { when: formatRelative(preview.data.at, i18n.language) })
          : t('ui.cleaner.previewNoRun')}
        {inst.config.dryRun ? ` ${t('ui.cleaner.previewDryRun')}` : ''}
      </p>
      {preview.isPending ? <Skeleton className="h-24 rounded-lg" /> : null}
      {preview.isSuccess && actions.length === 0 ? (
        <EmptyState title={t('ui.cleaner.previewNothing')} />
      ) : null}
      <ul className="flex flex-col divide-y divide-border">
        {actions.map((d) => (
          <li key={d.key} className="flex flex-col gap-1 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  d.action.type === 'remove' ? 'critical' : d.action.type === 'strike' ? 'warning' : 'neutral'
                }
              >
                {t(`ui.cleaner.previewAction.${d.action.type}`)}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={d.title}>
                {d.title}
              </span>
            </div>
            <span className="text-xs text-muted">{tm(t, d.reason)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// --------------------------------------------------------------- history

function History({ instanceId }: { instanceId: string }) {
  const { t, i18n } = useTranslation();
  const history = useQuery({
    queryKey: ['cleaner-history', instanceId],
    queryFn: () =>
      api<{ entries: HistoryEntry[] }>(`/api/cleaner/history?instance=${enc(instanceId)}&limit=100`),
  });
  const entries = history.data?.entries ?? [];
  return (
    <Card>
      {history.isPending ? <Skeleton className="h-32 rounded-lg" /> : null}
      {history.isSuccess && entries.length === 0 ? (
        <EmptyState title={t('ui.cleaner.historyEmpty')} body={t('ui.cleaner.historyEmptyBody')} />
      ) : null}
      <ul className="flex flex-col divide-y divide-border">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-col gap-1 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={e.ok ? (KIND_TONE[e.kind] ?? 'neutral') : 'critical'}>
                {t(`cleaner.kind.${e.kind}`, { defaultValue: e.kind })}
              </Badge>
              {e.dryRun && e.kind !== 'disarmed' ? (
                <Badge tone="info">{t('ui.cleaner.mode.dryRun')}</Badge>
              ) : null}
              {!e.ok ? <Badge tone="critical">{t('ui.cleaner.failed')}</Badge> : null}
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={e.title}>
                {e.title === '-' ? '' : e.title}
              </span>
              <time
                className="text-xs text-muted"
                dateTime={e.at}
                title={new Date(e.at).toLocaleString(i18n.language)}
              >
                {formatRelative(e.at, i18n.language)}
              </time>
            </div>
            <span className="text-xs text-muted">
              {t(`cleaner.rule.${e.rule}`, { defaultValue: e.rule })} · {tm(t, e.reason)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// -------------------------------------------------------------- attempts

function Attempts({ inst }: { inst: CleanerInstance }) {
  const { t } = useTranslation();
  const reset = useCleanerAction<{ titleKey: string }>(inst.instanceId, '/attempts/reset');
  return (
    <Card className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        {t('ui.cleaner.attemptsIntro', { count: inst.config.attemptsPerTitle })}
      </p>
      {inst.exhausted.length === 0 ? <EmptyState title={t('ui.cleaner.attemptsEmpty')} /> : null}
      <ul className="flex flex-col divide-y divide-border">
        {inst.exhausted.map((a) => (
          <li key={a.titleKey} className="flex flex-wrap items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={a.title}>
              {a.title}
            </span>
            <Badge tone="warning">{t('ui.cleaner.attemptsUsed', { count: a.attempts })}</Badge>
            <Button
              busy={reset.isPending && reset.variables?.titleKey === a.titleKey}
              onClick={() => reset.mutate({ titleKey: a.titleKey })}
            >
              {t('ui.cleaner.resetAttempts')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// --------------------------------------------------------------- orphans

function Orphans({ orphans, client }: { orphans: Orphan[]; client?: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<Orphan | null>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const del = useMutation({
    mutationFn: (o: Orphan) =>
      api('/api/cleaner/orphans/delete', {
        method: 'POST',
        body: { clientId: o.clientId, jobId: o.id, deleteFiles, confirm: true },
      }),
    onSuccess: () => {
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ['cleaner'] });
    },
  });
  const list = orphans.filter((o) => !client || o.clientId === client);
  return (
    <Card className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t('ui.cleaner.orphansIntro')}</p>
      {list.length === 0 ? <EmptyState title={t('ui.cleaner.orphansEmpty')} /> : null}
      <ul className="flex flex-col divide-y divide-border">
        {list.map((o) => (
          <li key={`${o.clientId}:${o.id}`} className="flex flex-wrap items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={o.name}>
              {o.name}
            </span>
            <span className="text-xs text-muted">{o.clientName}</span>
            <Button variant="ghost" onClick={() => setDeleting(o)}>
              {t('ui.cleaner.deleteOrphan')}
            </Button>
          </li>
        ))}
      </ul>
      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('ui.cleaner.deleteOrphanTitle')}
        description={deleting?.name}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            {t('ui.cleaner.deleteOrphanBody', { client: deleting?.clientName })}
          </p>
          <Toggle label={t('ui.cleaner.deleteFiles')} checked={deleteFiles} onChange={setDeleteFiles} />
          {del.isError ? <InlineError {...errorText(t, del.error)} /> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {t('ui.common.cancel')}
            </Button>
            <Button variant="danger" busy={del.isPending} onClick={() => deleting && del.mutate(deleting)}>
              {t('ui.cleaner.deleteOrphanConfirm')}
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}

// -------------------------------------------------------------- settings

function listText(v: string[]): string {
  return v.join(', ');
}

function Settings({ inst }: { inst: CleanerInstance }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState(inst.config);
  const [tags, setTags] = useState(listText(inst.config.protectedTags));
  const [whitelist, setWhitelist] = useState(listText(inst.config.whitelist));
  const set = <K extends keyof CleanerConfig>(k: K, v: CleanerConfig[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const { dryRun: _dryRun, ...rest } = form;
      const split = (s: string) =>
        s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
      return api(`/api/cleaner/${enc(inst.instanceId)}/settings`, {
        method: 'PUT',
        body: { ...rest, protectedTags: split(tags), whitelist: split(whitelist) },
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cleaner'] }),
  });
  const h = t('ui.units.hours');
  const m = t('ui.units.minutes');

  return (
    <Card>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Toggle
          label={t('ui.cleaner.s.enabled')}
          help={t('ui.cleaner.s.enabledHelp')}
          checked={form.enabled}
          onChange={(v) => set('enabled', v)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label={t('ui.cleaner.s.maxStrikes')}
            help={t('ui.cleaner.s.maxStrikesHelp')}
            min={1}
            max={50}
            value={form.maxStrikes}
            onChange={(v) => set('maxStrikes', v)}
          />
          <NumberField
            label={t('ui.cleaner.s.strikeInterval')}
            help={t('ui.cleaner.s.strikeIntervalHelp')}
            min={1}
            unit={m}
            value={form.strikeIntervalMinutes}
            onChange={(v) => set('strikeIntervalMinutes', v)}
          />
        </div>
        <Toggle
          label={t('ui.cleaner.s.waitForImportClick')}
          help={t('ui.cleaner.s.waitForImportClickHelp')}
          checked={form.waitForImportClick}
          onChange={(v) => set('waitForImportClick', v)}
        />
        <Toggle
          label={t('ui.cleaner.s.failed')}
          help={t('ui.cleaner.s.failedHelp')}
          checked={form.failedEnabled}
          onChange={(v) => set('failedEnabled', v)}
        />
        <Toggle
          label={t('ui.cleaner.s.slow')}
          help={t('ui.cleaner.s.slowHelp')}
          checked={form.slowEnabled}
          onChange={(v) => set('slowEnabled', v)}
        />

        <Disclosure title={t('ui.common.advanced')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label={t('ui.cleaner.s.checkInterval')}
              min={1}
              unit={m}
              value={form.checkIntervalMinutes}
              onChange={(v) => set('checkIntervalMinutes', v)}
            />
            <NumberField
              label={t('ui.cleaner.s.attempts')}
              help={t('ui.cleaner.s.attemptsHelp')}
              min={1}
              value={form.attemptsPerTitle}
              onChange={(v) => set('attemptsPerTitle', v)}
            />
            <NumberField
              label={t('ui.cleaner.s.tbaMaxWait')}
              min={1}
              unit={h}
              value={form.tbaMaxWaitHours}
              onChange={(v) => set('tbaMaxWaitHours', v)}
            />
            <NumberField
              label={t('ui.cleaner.s.importClickMax')}
              min={1}
              unit={h}
              value={form.importClickMaxHours}
              onChange={(v) => set('importClickMaxHours', v)}
            />
            <NumberField
              label={t('ui.cleaner.s.stalledAfter')}
              min={1}
              unit={h}
              value={form.stalledAfterHours}
              onChange={(v) => set('stalledAfterHours', v)}
            />
            <NumberField
              label={t('ui.cleaner.s.slowMin')}
              min={1}
              unit="KB/s"
              value={Math.round(form.slowMinBytesPerSecond / 1024)}
              onChange={(v) => set('slowMinBytesPerSecond', v * 1024)}
            />
            <NumberField
              label={t('ui.cleaner.s.maxRemovals')}
              help={t('ui.cleaner.s.maxRemovalsHelp')}
              min={1}
              value={form.maxRemovalsPerRun}
              onChange={(v) => set('maxRemovalsPerRun', v)}
            />
          </div>
          <TextField
            label={t('ui.cleaner.s.protectedTags')}
            help={t('ui.cleaner.s.protectedTagsHelp')}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <TextField
            label={t('ui.cleaner.s.whitelist')}
            help={t('ui.cleaner.s.whitelistHelp')}
            value={whitelist}
            onChange={(e) => setWhitelist(e.target.value)}
          />
        </Disclosure>

        {save.isError ? <InlineError {...errorText(t, save.error)} /> : null}
        <div className="flex items-center justify-end gap-3">
          {save.isSuccess ? (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-ok"
              role="status"
            >
              {t('ui.common.saved')}
            </motion.span>
          ) : null}
          <Button type="submit" variant="primary" busy={save.isPending}>
            {t('ui.common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
