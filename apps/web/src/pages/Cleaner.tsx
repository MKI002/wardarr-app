// Queue Cleaner: every download with its rule, strikes and next step, a
// preview of the next run, the history, and the settings per instance.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { Msg } from '@wardarr/core';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionMenu } from '../components/ActionMenu';
import { Columns, Funnel, ProgressRing, toneColor, useCalm, type ChartTone } from '../components/charts';
import { InstanceChips, PageHeader, SectionRule } from '../components/dash';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import {
  Badge,
  Button,
  Card,
  Disclosure,
  EYE_PATH,
  EmptyState,
  InlineError,
  NumberField,
  SHIELD_PATH,
  Skeleton,
  StrikeMeter,
  Tabs,
  TextField,
  Toggle,
  ViewTransition,
  spring,
  useSvgId,
  type Tone,
} from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatRelative } from '../lib/format';
import { tm } from '../lib/i18n';
import { parseRelease } from '../lib/release';

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
  adapter: string;
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
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('ui.cleaner.eyebrow')}
        title={t('ui.cleaner.title')}
        intro={t('ui.cleaner.subtitle')}
      />
      {instances.length > 1 ? (
        <InstanceChips
          label={t('ui.cleaner.instances')}
          items={instances.map((i) => ({
            id: i.instanceId,
            name: i.instanceName,
            adapter: i.adapter,
            count: i.downloads.filter((d) => d.strikes > 0).length,
            tone: instanceTone(i),
          }))}
          current={current?.instanceId}
          onPick={(id) => setSearch({ instance: id, review: undefined })}
        />
      ) : null}

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
          <CleanerHero inst={current} />
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
          <ViewTransition view={`${current.instanceId}:${tab}`}>
            {tab === 'downloads' ? (
              <Downloads inst={current} review={search.review} onReview={(review) => setSearch({ review })} />
            ) : null}
            {tab === 'preview' ? <Preview inst={current} /> : null}
            {tab === 'history' ? <History instanceId={current.instanceId} /> : null}
            {tab === 'attempts' ? <Attempts inst={current} /> : null}
            {tab === 'orphans' ? <Orphans orphans={data.data?.orphans ?? []} client={search.client} /> : null}
            {tab === 'settings' ? <Settings key={current.instanceId} inst={current} /> : null}
          </ViewTransition>
        </>
      ) : null}
    </div>
  );
}

function instanceTone(i: CleanerInstance): ChartTone {
  if (i.paused || i.error) return 'critical';
  if (i.downloads.some((d) => d.action.type === 'remove' || d.strikes > 0)) return 'warning';
  return i.config.enabled ? 'ok' : 'neutral';
}

// ------------------------------------------------------------------ hero

const MODE_TILE: Record<'off' | 'dryRun' | 'armed', string> = {
  off: 'bg-surface-2 text-muted',
  dryRun: 'bg-info-bg text-info',
  armed: 'bg-critical-bg text-critical',
};
const MODE_TEXT: Record<'off' | 'dryRun' | 'armed', string> = {
  off: 'text-muted',
  dryRun: 'text-info',
  armed: 'text-critical',
};

/**
 * The guardian's shield in the mode tile: an open eye in dry run, a check when
 * armed, struck through when off. A solid shield with the sign cut out, like
 * the logo, so it still reads at tile size.
 */
function ModeShield({ mode }: { mode: 'off' | 'dryRun' | 'armed' }) {
  const calm = useCalm();
  const mask = useSvgId('mode-shield');
  return (
    <span className={`relative grid size-16 shrink-0 place-items-center rounded-2xl ${MODE_TILE[mode]}`}>
      {mode === 'armed' ? (
        <span className="ring-pulse absolute inset-0 rounded-2xl ring-2 ring-critical" aria-hidden />
      ) : null}
      <motion.svg
        key={mode}
        viewBox="0 0 64 64"
        className="size-10"
        aria-hidden
        initial={calm ? false : { rotateY: 90, scale: 0.8 }}
        animate={{ rotateY: 0, scale: 1 }}
        transition={spring}
      >
        <mask id={mask}>
          <path d={SHIELD_PATH} fill="#fff" />
          {mode === 'dryRun' ? (
            <>
              <path d={EYE_PATH} fill="#000" />
              <circle cx="32" cy="31" r="6.4" fill="#fff" />
              <circle cx="34.2" cy="28.9" r="2.1" fill="#000" />
            </>
          ) : (
            <path
              d={mode === 'armed' ? 'm22.5 31.5 6.5 6.5 12.5-13' : 'm23 22 18 18'}
              fill="none"
              stroke="#000"
              strokeWidth="5.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </mask>
        <path d={SHIELD_PATH} fill="currentColor" mask={`url(#${mask})`} />
      </motion.svg>
    </span>
  );
}

function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function Countdown({ inst }: { inst: CleanerInstance }) {
  const { t, i18n } = useTranslation();
  const now = useNow(1000);
  const next = inst.nextRunAt ? Date.parse(inst.nextRunAt) : null;
  const last = inst.lastRunAt ? Date.parse(inst.lastRunAt) : null;
  const span = next && last && next > last ? next - last : inst.config.checkIntervalMinutes * 60_000;
  const left = next ? Math.max(0, next - now) : null;
  const share = left === null ? 0 : 1 - left / span;
  return (
    <div className="flex flex-col items-center gap-2 text-center">
      <ProgressRing value={share} size={132} stroke={8} label={t('ui.cleaner.countdown')}>
        <span className="flex flex-col items-center">
          <span className="text-2xl font-semibold tracking-tight tabular-nums">
            {left === null ? '–' : clock(left)}
          </span>
          <span className="max-w-20 text-[11px] leading-tight font-normal text-muted">
            {left === null ? t('ui.cleaner.notScheduled') : t('ui.cleaner.untilNext')}
          </span>
        </span>
      </ProgressRing>
      <span className="text-xs text-muted">
        {t('ui.cleaner.lastRunWhen', {
          when: inst.lastRunAt ? formatRelative(inst.lastRunAt, i18n.language) : t('ui.cleaner.never'),
        })}
      </span>
    </div>
  );
}

function QueueFunnel({ inst }: { inst: CleanerInstance }) {
  const { t } = useTranslation();
  const strikes = inst.downloads.filter((d) => d.strikes > 0).length;
  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
        {t('ui.cleaner.queueNow')}
      </span>
      <Funnel
        label={t('ui.cleaner.queueNow')}
        stages={[
          {
            key: 'downloads',
            label: t('ui.cleaner.funnel.downloads'),
            value: inst.downloads.length,
            tone: 'accent',
          },
          { key: 'strikes', label: t('ui.cleaner.funnel.strikes'), value: strikes, tone: 'warning' },
          {
            key: 'remove',
            label: t('ui.cleaner.funnel.remove'),
            value: inst.downloads.filter((d) => d.action.type === 'remove').length,
            tone: 'critical',
          },
        ]}
      />
      <p className="text-sm">
        {strikes > 0 ? t('ui.cleaner.funnelStuck', { count: strikes }) : t('ui.cleaner.funnelClear')}
      </p>
    </div>
  );
}

function CleanerHero({ inst }: { inst: CleanerInstance }) {
  const { t } = useTranslation();
  const [arming, setArming] = useState(false);
  const arm = useCleanerAction<{ confirm: true }>(inst.instanceId, '/arm');
  const disarm = useCleanerAction<Record<string, never>>(inst.instanceId, '/disarm');
  const run = useCleanerAction<Record<string, never>>(inst.instanceId, '/run');
  const dry = inst.config.dryRun;
  const mode = !inst.config.enabled ? 'off' : dry ? 'dryRun' : 'armed';

  return (
    <Card className="flex flex-col gap-5">
      <div className="grid gap-8 lg:grid-cols-[1.1fr_1.5fr_auto] lg:items-center">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <ModeShield mode={mode} />
            <div className="flex min-w-0 flex-col">
              <span className="text-xs text-muted">{inst.instanceName}</span>
              <motion.span
                key={mode}
                layout
                className={`text-3xl font-bold tracking-tight ${MODE_TEXT[mode]}`}
                transition={spring}
              >
                {t(`ui.cleaner.mode.${mode}`)}
              </motion.span>
            </div>
          </div>
          <p
            className="text-sm text-muted"
            title={dry ? t('ui.cleaner.dryRunHint') : t('ui.cleaner.armedHint')}
          >
            {t(`ui.cleaner.modeShort.${mode}`)}
          </p>
          <div className="flex flex-wrap gap-2">
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
        <QueueFunnel inst={inst} />
        <Countdown inst={inst} />
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

  const release = parseRelease(d.title);
  const tone = RULE_TONE[d.rule] ?? 'neutral';
  const showStrikes = d.strikes > 0 || tone === 'warning' || tone === 'critical';

  return (
    <motion.li layout transition={spring} className="flex flex-col gap-2 py-3.5">
      <div className="flex items-start gap-3">
        <span
          className="mt-1.5 h-9 w-1 shrink-0 rounded-full"
          style={{ background: tone === 'neutral' ? 'var(--border)' : toneColor(tone) }}
          aria-hidden
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="sr-only">{d.title}</span>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-hidden>
            <span className="min-w-0 truncate font-medium" title={d.title}>
              {release.title}
            </span>
            {(release.episode ?? release.year) ? (
              <span className="rounded-md bg-surface-2 px-1.5 text-xs font-semibold tabular-nums">
                {release.episode ?? release.year}
              </span>
            ) : null}
            {release.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-xs text-muted">
                {tag}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <Badge tone={tone}>{t(`cleaner.rule.${d.rule}`)}</Badge>
            {!d.matched ? <Badge tone="warning">{t('ui.queue.unmatched')}</Badge> : null}
            {d.action.type === 'remove' ? <Badge tone="critical">{t('ui.cleaner.nextRemoves')}</Badge> : null}
            <span>{tm(t, d.reason)}</span>
            {when ? (
              <span>
                {d.waitUntil
                  ? t('ui.cleaner.waitsUntil', { when: formatRelative(d.waitUntil, i18n.language) })
                  : t('ui.cleaner.nextStrike', { when: formatRelative(when, i18n.language) })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {showStrikes ? (
            <span className="hidden items-center gap-2 sm:inline-flex">
              <StrikeMeter
                size="lg"
                strikes={d.strikes}
                max={d.maxStrikes}
                label={t('ui.cleaner.strikes', { strikes: d.strikes, max: d.maxStrikes })}
              />
              <span className="w-7 text-xs text-muted tabular-nums">
                {d.strikes}/{d.maxStrikes}
              </span>
            </span>
          ) : null}
          {reviewable ? (
            <Button
              variant={d.rule === 'importReady' ? 'primary' : 'secondary'}
              onClick={() => onReview(d.key)}
            >
              {t('issues.action.reviewImport')}
            </Button>
          ) : null}
          <ActionMenu
            label={t('ui.common.moreActions')}
            actions={[
              {
                label: d.rule === 'ignored' ? t('ui.cleaner.unignore') : t('ui.cleaner.ignore'),
                disabled: ignore.isPending,
                onSelect: () => ignore.mutate({ key: d.key, ignored: d.rule !== 'ignored' }),
              },
              { label: t('ui.cleaner.removeNow'), danger: true, onSelect: () => setRemoving(true) },
            ]}
          />
        </div>
      </div>
      {showStrikes ? (
        <span className="flex items-center gap-2 pl-4 sm:hidden">
          <StrikeMeter
            size="lg"
            strikes={d.strikes}
            max={d.maxStrikes}
            label={t('ui.cleaner.strikes', { strikes: d.strikes, max: d.maxStrikes })}
          />
          <span className="text-xs text-muted tabular-nums">
            {d.strikes}/{d.maxStrikes}
          </span>
        </span>
      ) : null}
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
    <div className="flex flex-col gap-4">
      <Activity instanceId={instanceId} />
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
    </div>
  );
}

function Activity({ instanceId }: { instanceId: string }) {
  const { t, i18n } = useTranslation();
  const activity = useQuery({
    queryKey: ['cleaner-activity', instanceId],
    queryFn: () =>
      api<{ days: Array<{ day: string; strikes: number; removed: number; imported: number }> }>(
        `/api/cleaner/activity?instance=${enc(instanceId)}&days=14&tz=${-new Date().getTimezoneOffset()}`,
      ),
  });
  const dayLabel = (day: string) =>
    new Date(`${day}T12:00:00`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' });
  const series = [
    { key: 'strikes', tone: 'warning' },
    { key: 'removed', tone: 'critical' },
    { key: 'imported', tone: 'ok' },
  ] as const;
  return (
    <Card className="flex flex-col gap-3">
      <SectionRule>{t('ui.cleaner.activity')}</SectionRule>
      {activity.isPending ? <Skeleton className="h-40 rounded-lg" /> : null}
      {activity.isSuccess ? (
        <Columns
          height={150}
          legend
          label={t('ui.cleaner.activityLabel')}
          emptyLabel={t('ui.cleaner.activityNone')}
          data={activity.data.days.map((d) => ({
            key: d.day,
            label: dayLabel(d.day),
            parts: series.map((s) => ({
              tone: s.tone,
              value: d[s.key],
              label: t(`ui.cleaner.series.${s.key}`),
            })),
          }))}
        />
      ) : null}
      <p className="text-xs text-muted">{t('ui.cleaner.activityDryRun')}</p>
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
