// Storage: every disk the *arr apps use, counted once, with a forecast of
// when it runs full. The hero answers "will I run out of space soon?".
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { formatBytes } from '@wardarr/i18n';
import { motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { tint, toneColor, useCalm, type ChartTone } from '../components/charts';
import { MiniBars, Odometer, PageHeader, SectionRule } from '../components/dash';
import { ServiceLogo } from '../components/ServiceLogo';
import { ForecastChart } from '../components/storage/ForecastChart';
import {
  Badge,
  Button,
  Card,
  Choice,
  Disclosure,
  EmptyState,
  InlineError,
  NumberField,
  SectionTitle,
  Skeleton,
  StatusDot,
  ViewTransition,
  spring,
  type Tone,
} from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatRelative } from '../lib/format';

type Level = 'ok' | 'warning' | 'critical';

interface Forecast {
  status: 'collecting' | 'stable' | 'filling' | 'full';
  bytesPerDay: number | null;
  daysLeft: number | null;
  fullAt: string | null;
  earliestAt: string | null;
  latestAt: string | null;
  basisDays: number;
}

interface DiskView {
  key: string;
  label: string;
  media: boolean;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  lastSeenAt: string;
  members: Array<{
    instanceId: string;
    instanceName: string;
    adapter: string;
    path: string;
    rootFolders: string[];
  }>;
  forecast: Forecast;
  level: Level;
  reason: 'lowSpace' | 'forecast' | null;
}

interface Settings {
  warnDays: number;
  criticalDays: number;
  warnPercent: number;
  criticalPercent: number;
  lookbackDays: number;
}

interface StorageData {
  refreshedAt: string | null;
  refreshing: boolean;
  settings: Settings;
  apps: Array<{ instanceId: string; instanceName: string; adapter: string; error: string | null }>;
  disks: DiskView[];
  history: Record<string, Array<{ day: string; usedBytes: number; totalBytes: number }>>;
}

const RANGES = [30, 90, 365] as const;
const LEVEL_TONE: Record<Level, Tone> = { ok: 'ok', warning: 'warning', critical: 'critical' };
/** Meter fill: magnitude in accent while fine, the status colour once it is not. */
const METER_TONE: Record<Level, ChartTone> = { ok: 'accent', warning: 'warning', critical: 'critical' };

export function StoragePage() {
  const { t } = useTranslation();
  const [days, setDays] = useState<(typeof RANGES)[number]>(90);
  const query = useQuery({
    queryKey: ['storage', days],
    queryFn: () => api<StorageData>(`/api/storage?days=${days}`),
    refetchInterval: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
  const client = useQueryClient();
  const refresh = useMutation({
    mutationFn: () => api('/api/storage/refresh', { method: 'POST' }),
    onSettled: () => client.invalidateQueries({ queryKey: ['storage'] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('ui.storage.eyebrow')}
        title={t('ui.storage.title')}
        intro={t('ui.storage.intro')}
        actions={
          <>
            <Choice
              label={t('ui.storage.range')}
              hideLabel
              value={String(days)}
              onChange={(v) => setDays(Number(v) as (typeof RANGES)[number])}
              options={RANGES.map((d) => [String(d), t('ui.storage.days', { count: d })])}
            />
            <Button onClick={() => refresh.mutate()} busy={refresh.isPending || query.data?.refreshing}>
              {t('ui.storage.refresh')}
            </Button>
          </>
        }
      />
      {query.isError ? (
        <InlineError {...errorText(t, query.error)} onRetry={() => void query.refetch()} />
      ) : null}
      {query.data ? (
        <StorageBody data={query.data} days={days} />
      ) : query.isError ? null : (
        <StorageSkeleton />
      )}
    </div>
  );
}

function StorageSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-96 rounded-[var(--radius-card)] lg:col-span-3" />
        <Skeleton className="h-96 rounded-[var(--radius-card)] lg:col-span-2" />
      </div>
      <Skeleton className="h-40 rounded-[var(--radius-card)]" />
    </div>
  );
}

function useFormat() {
  const { i18n } = useTranslation();
  const lang = i18n.language;
  return {
    bytes: (n: number) => formatBytes(n, lang),
    date: (ms: number) =>
      new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(new Date(ms)),
    longDate: (iso: string) =>
      new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)),
    lang,
  };
}

function StorageBody({ data, days }: { data: StorageData; days: number }) {
  const { t } = useTranslation();
  const search = useSearch({ from: '/storage' });
  const navigate = useNavigate({ from: '/storage' });
  const { disks } = data;
  const selected = disks.find((d) => d.key === search.disk) ?? disks[0];
  const failing = data.apps.filter((a) => a.error);

  if (disks.length === 0) {
    return (
      <Card>
        <EmptyState
          title={t(data.refreshedAt ? 'ui.storage.emptyTitle' : 'ui.storage.readingTitle')}
          body={t(data.refreshedAt ? 'ui.storage.emptyBody' : 'ui.storage.readingBody')}
        />
      </Card>
    );
  }

  const select = (key: string) =>
    void navigate({ search: { disk: key === disks[0]?.key ? undefined : key }, replace: true });
  const media = disks.filter((d) => d.media);
  const other = disks.filter((d) => !d.media);

  return (
    <>
      {failing.length > 0 ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning"
        >
          <StatusDot tone="warning" label={t('ui.status.degraded')} />
          {t('ui.storage.appsFailed', {
            count: failing.length,
            apps: failing.map((a) => a.instanceName).join(', '),
          })}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-5">
        {selected ? (
          <Hero disk={selected} data={data} days={days} isWorst={selected.key === disks[0]?.key} />
        ) : null}
        <motion.div
          className="lg:col-span-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.05 }}
        >
          <Card as="div" className="flex h-full flex-col gap-4">
            <Totals disks={media.length > 0 ? media : disks} />
            <DiskList
              title={t('ui.storage.mediaDisks')}
              disks={media}
              selected={selected?.key}
              onSelect={select}
            />
            <DiskList
              title={t('ui.storage.otherDisks')}
              disks={other}
              selected={selected?.key}
              onSelect={select}
            />
          </Card>
        </motion.div>
      </div>

      {selected ? (
        <ViewTransition view={selected.key}>
          <DiskDetails disk={selected} history={data.history[selected.key] ?? []} settings={data.settings} />
        </ViewTransition>
      ) : null}

      <ThresholdSettings
        key={JSON.stringify(data.settings)}
        settings={data.settings}
        refreshedAt={data.refreshedAt}
      />
    </>
  );
}

/** One plain sentence for the state of a disk. */
function useSentence() {
  const { t } = useTranslation();
  const f = useFormat();
  return (disk: DiskView) => {
    const fc = disk.forecast;
    const pct = Math.round((disk.freeBytes / disk.totalBytes) * 1000) / 10;
    if (fc.status === 'full') return t('ui.storage.sentenceFull', { disk: disk.label });
    if (fc.status === 'collecting')
      return t('ui.storage.sentenceCollecting', {
        disk: disk.label,
        count: Math.max(1, Math.ceil(3 - fc.basisDays)),
      });
    if (fc.status === 'stable')
      return disk.level === 'ok'
        ? t('ui.storage.sentenceStable', { disk: disk.label })
        : t('ui.storage.sentenceStableLow', { disk: disk.label, percent: pct });
    return fc.latestAt
      ? t('ui.storage.sentenceFilling', {
          disk: disk.label,
          from: f.date(Date.parse(fc.earliestAt!)),
          to: f.date(Date.parse(fc.latestAt)),
        })
      : t('ui.storage.sentenceFillingOpen', { disk: disk.label, from: f.date(Date.parse(fc.earliestAt!)) });
  };
}

function Hero({
  disk,
  data,
  days,
  isWorst,
}: {
  disk: DiskView;
  data: StorageData;
  days: number;
  isWorst: boolean;
}) {
  const { t } = useTranslation();
  const f = useFormat();
  const sentence = useSentence();
  const fc = disk.forecast;
  const filling = fc.status === 'filling' && fc.daysLeft !== null;
  const daysLeft = filling ? Math.max(0, Math.round(fc.daysLeft!)) : 0;
  const tone = LEVEL_TONE[disk.level];

  return (
    <motion.div
      className="lg:col-span-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <Card as="div" className="flex h-full flex-col gap-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-3">
            <span className="flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-muted uppercase">
              <StatusDot tone={tone} label={t(`ui.storage.level.${disk.level}`)} />
              {isWorst ? t('ui.storage.tightest') : t('ui.storage.selected')} · {disk.label}
            </span>
            <div className="flex items-baseline gap-3">
              <span className="text-6xl leading-none font-bold tracking-tight">
                <Odometer text={filling ? String(daysLeft) : f.bytes(disk.freeBytes)} />
              </span>
              <span className="text-lg text-muted">
                {filling
                  ? t('ui.storage.daysUntilFull', { count: daysLeft })
                  : t('ui.storage.freeOf', { total: f.bytes(disk.totalBytes) })}
              </span>
            </div>
            <p className="max-w-prose text-base font-medium text-balance">{sentence(disk)}</p>
          </div>
          {disk.level !== 'ok' ? <Badge tone={tone}>{t(`ui.storage.level.${disk.level}`)}</Badge> : null}
        </div>
        <ForecastChart
          input={{
            history: data.history[disk.key] ?? [],
            usedBytes: disk.usedBytes,
            totalBytes: disk.totalBytes,
            forecast: fc,
          }}
          rangeDays={days}
          now={Date.parse(disk.lastSeenAt)}
          tone={disk.level === 'ok' ? 'accent' : tone}
          bytes={f.bytes}
          date={f.date}
          labels={{
            chart: `${t('ui.storage.chartLabel', { disk: disk.label })} ${sentence(disk)}`,
            today: t('ui.storage.today'),
            capacity: t('ui.storage.capacity'),
            fullOn: (date) => t('ui.storage.fullOn', { date }),
            fullLater: (count) => t('ui.storage.fullLater', { count }),
            used: t('ui.storage.used'),
            free: t('ui.storage.free'),
            projected: t('ui.storage.projected'),
          }}
        />
        <Legend forecast={fc} />
      </Card>
    </motion.div>
  );
}

function Legend({ forecast }: { forecast: Forecast }) {
  const { t } = useTranslation();
  const items: Array<[string, ReactNode]> = [
    [t('ui.storage.legendUsed'), <span key="u" className="h-0.5 w-4 rounded bg-accent" />],
  ];
  if (forecast.status === 'filling' || forecast.status === 'stable')
    items.push([
      t('ui.storage.legendForecast'),
      <svg key="f" width="16" height="4" aria-hidden>
        <line
          x1="1"
          x2="15"
          y1="2"
          y2="2"
          stroke={tint('accent', 70)}
          strokeWidth="2"
          strokeDasharray="5 3"
          strokeLinecap="round"
        />
      </svg>,
    ]);
  const spread =
    forecast.status === 'filling' && forecast.earliestAt
      ? forecast.latestAt
        ? Date.parse(forecast.latestAt) - Date.parse(forecast.earliestAt)
        : Infinity
      : 0;
  // The range only gets a key when it is wide enough to see.
  if (spread >= 2 * 86_400_000)
    items.push([
      t('ui.storage.legendRange'),
      <span key="r" className="size-2.5 rounded-sm" style={{ background: tint('accent', 16) }} />,
    ]);
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      {items.map(([label, key]) => (
        <li key={label} className="flex items-center gap-1.5">
          {key}
          {label}
        </li>
      ))}
    </ul>
  );
}

function Totals({ disks }: { disks: DiskView[] }) {
  const { t } = useTranslation();
  const f = useFormat();
  const total = disks.reduce((s, d) => s + d.totalBytes, 0);
  const free = disks.reduce((s, d) => s + d.freeBytes, 0);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
        {t('ui.storage.together')}
      </span>
      <span className="text-3xl font-semibold tracking-tight">{f.bytes(free)}</span>
      <span className="text-xs text-muted">
        {t('ui.storage.togetherSub', { count: disks.length, total: f.bytes(total) })}
      </span>
    </div>
  );
}

function DiskList({
  title,
  disks,
  selected,
  onSelect,
}: {
  title: string;
  disks: DiskView[];
  selected: string | undefined;
  onSelect: (key: string) => void;
}) {
  if (disks.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <SectionTitle>{title}</SectionTitle>
      <ul className="-mx-2 flex flex-col">
        {disks.map((d, i) => (
          <DiskRow
            key={d.key}
            disk={d}
            index={i}
            active={d.key === selected}
            onSelect={() => onSelect(d.key)}
          />
        ))}
      </ul>
    </div>
  );
}

function DiskRow({
  disk,
  index,
  active,
  onSelect,
}: {
  disk: DiskView;
  index: number;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const f = useFormat();
  const calm = useCalm();
  const share = disk.totalBytes > 0 ? disk.usedBytes / disk.totalBytes : 0;
  const apps = [...new Map(disk.members.map((m) => [m.instanceId, m])).values()];
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className={`flex w-full flex-col gap-1.5 rounded-xl px-2 py-2.5 text-left transition-colors ${active ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
      >
        <span className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium">{disk.label}</span>
          <span className="flex -space-x-1">
            {apps.slice(0, 4).map((m) => (
              <span key={m.instanceId} className="rounded-md ring-2 ring-surface" title={m.instanceName}>
                <ServiceLogo adapter={m.adapter} name={m.instanceName} />
              </span>
            ))}
          </span>
        </span>
        <span
          className="block h-2 w-full overflow-hidden rounded-full"
          style={{ background: tint(METER_TONE[disk.level], 18) }}
          role="meter"
          aria-label={t('ui.storage.meterLabel', { disk: disk.label })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
        >
          <motion.span
            className="block h-full rounded-full"
            style={{ width: `${share * 100}%`, background: toneColor(METER_TONE[disk.level]), originX: 0 }}
            initial={calm ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.5, delay: 0.1 + index * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
          />
        </span>
        <span className="flex items-center justify-between gap-2 text-xs text-muted">
          <span className="tabular-nums">
            {t('ui.storage.freeOfShort', { free: f.bytes(disk.freeBytes), total: f.bytes(disk.totalBytes) })}
          </span>
          <ForecastChip disk={disk} />
        </span>
      </button>
    </li>
  );
}

function ForecastChip({ disk }: { disk: DiskView }) {
  const { t } = useTranslation();
  const fc = disk.forecast;
  const text =
    fc.status === 'filling' && fc.daysLeft !== null
      ? t('ui.storage.chipDays', { count: Math.max(0, Math.round(fc.daysLeft)) })
      : t(`ui.storage.chip.${fc.status}`);
  return (
    <span className={`flex items-center gap-1.5 ${disk.level === 'ok' ? '' : 'font-medium text-text'}`}>
      {disk.level !== 'ok' ? (
        <StatusDot tone={LEVEL_TONE[disk.level]} label={t(`ui.storage.level.${disk.level}`)} />
      ) : null}
      {text}
    </span>
  );
}

function DiskDetails({
  disk,
  history,
  settings,
}: {
  disk: DiskView;
  history: StorageData['history'][string];
  settings: Settings;
}) {
  const { t } = useTranslation();
  const f = useFormat();
  const fc = disk.forecast;
  // Space added per day over the last two weeks; cleanups count as zero.
  const growth = history
    .slice(-15)
    .flatMap((p, i, all) => (i === 0 ? [] : [Math.max(0, p.usedBytes - all[i - 1]!.usedBytes)]));
  const rate = fc.bytesPerDay;
  return (
    <section className="flex flex-col gap-4">
      <SectionRule>{t('ui.storage.detailsTitle', { disk: disk.label })}</SectionRule>
      <div className="grid gap-4 md:grid-cols-3">
        <Card as="div" className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            {t('ui.storage.growth')}
          </span>
          <span className="text-3xl font-semibold tracking-tight">
            {rate === null
              ? '–'
              : t('ui.storage.perDay', { value: `${rate > 0 ? '+' : ''}${f.bytes(rate)}` })}
          </span>
          <span className="text-xs text-muted">
            {fc.status === 'collecting'
              ? t('ui.storage.growthCollecting')
              : t('ui.storage.growthBasis', {
                  count: Math.round(Math.min(fc.basisDays, settings.lookbackDays)),
                })}
          </span>
          {growth.length > 1 ? (
            <div className="mt-2">
              <MiniBars values={growth} label={t('ui.storage.growthBars', { disk: disk.label })} />
            </div>
          ) : null}
        </Card>
        <Card as="div" className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            {t('ui.storage.fullWhen')}
          </span>
          <span className="text-3xl font-semibold tracking-tight">
            {fc.status === 'filling' && fc.fullAt
              ? f.date(Date.parse(fc.fullAt))
              : t(`ui.storage.chip.${fc.status}`)}
          </span>
          <span className="text-xs text-muted">
            {fc.status === 'filling' && fc.earliestAt
              ? fc.latestAt
                ? f.longDate(fc.latestAt) === f.longDate(fc.earliestAt)
                  ? t('ui.storage.rangeSteady')
                  : t('ui.storage.rangeBetween', {
                      from: f.longDate(fc.earliestAt),
                      to: f.longDate(fc.latestAt),
                    })
                : t('ui.storage.rangeOpen', { from: f.longDate(fc.earliestAt) })
              : t('ui.storage.thresholdHint', { days: settings.warnDays, percent: settings.warnPercent })}
          </span>
        </Card>
        <Card as="div" className="flex flex-col gap-2">
          <span className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            {t('ui.storage.usedBy')}
          </span>
          <ul className="flex flex-col gap-2">
            {byApp(disk.members).map((m) => (
              <li key={m.instanceId} className="flex items-start gap-2 text-sm">
                <ServiceLogo adapter={m.adapter} name={m.instanceName} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{m.instanceName}</span>
                  <span className="truncate font-mono text-xs text-muted" title={m.paths}>
                    {m.paths}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}

/** One line per app: its root folders on the disk, or the mounts it sees. */
function byApp(members: DiskView['members']) {
  const apps = new Map<
    string,
    { instanceId: string; instanceName: string; adapter: string; folders: string[]; mounts: string[] }
  >();
  for (const m of members) {
    const app = apps.get(m.instanceId) ?? { ...m, folders: [], mounts: [] };
    app.folders.push(...m.rootFolders);
    app.mounts.push(m.path);
    apps.set(m.instanceId, app);
  }
  return [...apps.values()].map((a) => ({
    ...a,
    paths: (a.folders.length ? a.folders : a.mounts).join(', '),
  }));
}

function ThresholdSettings({ settings, refreshedAt }: { settings: Settings; refreshedAt: string | null }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [draft, setDraft] = useState(settings);
  const save = useMutation({
    mutationFn: (s: Settings) => api('/api/storage/settings', { method: 'PUT', body: s }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['storage'] }),
  });
  const set = (k: keyof Settings) => (v: number) => setDraft((d) => ({ ...d, [k]: v }));
  const valid =
    Object.values(draft).every((v) => Number.isFinite(v)) &&
    draft.criticalDays <= draft.warnDays &&
    draft.criticalPercent <= draft.warnPercent;
  const changed = JSON.stringify(draft) !== JSON.stringify(settings);
  return (
    <div className="flex flex-col gap-2">
      <Disclosure title={t('ui.storage.settingsTitle')}>
        <p className="text-sm text-muted">{t('ui.storage.settingsIntro')}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField
            label={t('ui.storage.warnDays')}
            value={draft.warnDays}
            onChange={set('warnDays')}
            min={1}
            max={365}
            unit={t('ui.storage.unitDays')}
          />
          <NumberField
            label={t('ui.storage.criticalDays')}
            value={draft.criticalDays}
            onChange={set('criticalDays')}
            min={0}
            max={365}
            unit={t('ui.storage.unitDays')}
          />
          <NumberField
            label={t('ui.storage.warnPercent')}
            value={draft.warnPercent}
            onChange={set('warnPercent')}
            min={0}
            max={50}
            unit="%"
          />
          <NumberField
            label={t('ui.storage.criticalPercent')}
            value={draft.criticalPercent}
            onChange={set('criticalPercent')}
            min={0}
            max={50}
            unit="%"
          />
        </div>
        <NumberField
          label={t('ui.storage.lookback')}
          help={t('ui.storage.lookbackHelp')}
          value={draft.lookbackDays}
          onChange={set('lookbackDays')}
          min={7}
          max={180}
          unit={t('ui.storage.unitDays')}
        />
        {!valid ? <p className="text-xs text-critical">{t('ui.storage.invalid')}</p> : null}
        {save.isError ? <InlineError {...errorText(t, save.error)} /> : null}
        <div>
          <Button
            variant="primary"
            disabled={!valid || !changed}
            busy={save.isPending}
            onClick={() => save.mutate(draft)}
          >
            {t('ui.common.save')}
          </Button>
        </div>
      </Disclosure>
      {refreshedAt ? (
        <p className="text-xs text-muted">
          {t('ui.storage.checked', { when: formatRelative(refreshedAt, i18n.language) })}
        </p>
      ) : null}
    </div>
  );
}
