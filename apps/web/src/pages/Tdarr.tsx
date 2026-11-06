// Tdarr: what the transcode servers do right now, what they saved, how the
// last weeks went and which files failed. One view per Tdarr instance.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import {
  BarRow,
  Columns,
  LiveDot,
  ProgressRing,
  Ring,
  SegmentBar,
  Sparkline,
  type ColumnDatum,
  type RingSegment,
} from '../components/charts';
import { InstanceChips, KpiCard, MiniBars, Odometer, PageHeader, SectionRule } from '../components/dash';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InlineError,
  Skeleton,
  StatusDot,
  ViewTransition,
  spring,
  type Tone,
} from '../components/ui';
import { api, type InstanceStatus } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatBytes, formatRelative } from '../lib/format';
import { STATUS_TONE } from '../lib/instances';

interface Worker {
  id: string;
  kind: 'transcode' | 'healthCheck';
  gpu: boolean;
  file: string | null;
  progress: number;
  fps: number | null;
  eta: string | null;
  step: string | null;
  startedAt: string | null;
  originalBytes: number | null;
  estimatedBytes: number | null;
  stuckMinutes: number | null;
}

interface Node {
  id: string;
  name: string;
  paused: boolean;
  workers: Worker[];
  limits: { transcodeCpu: number; transcodeGpu: number; healthCheckCpu: number; healthCheckGpu: number };
  cpuPercent: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
}

interface Totals {
  files: number;
  transcodes: number;
  healthChecks: number;
  savedBytes: number;
  queued: { transcode: number; healthCheck: number };
  done: { transcode: number; healthCheck: number };
  failed: { transcode: number; healthCheck: number };
}

interface Day {
  day: string;
  transcodes: number;
  healthChecks: number;
  failed: number;
  savedBytes: number;
}

interface TdarrView {
  instanceId: string;
  instanceName: string;
  adapter: string;
  adapterName: string;
  status: InstanceStatus;
  version: string | null;
  compatibility: string | null;
  checkedAt: string | null;
  errorKind: string | null;
  webUrl: string | null;
  nodes: Node[];
  offline: Array<{ id: string; name: string; lastSeenAt: string }>;
  totals: Totals | null;
  history: Day[];
  libraries: Array<{
    id: string;
    name: string;
    folder: string | null;
    files: number | null;
    transcodes: number | null;
    healthChecks: number | null;
    savedBytes: number | null;
  }> | null;
  failures: Array<{
    file: string;
    kind: 'transcode' | 'healthCheck';
    outcome: 'error' | 'cancelled';
    at: string | null;
    sizeBytes: number | null;
  }> | null;
  detailError: string | null;
}

const baseName = (path: string) => path.split(/[\\/]/).pop() || path;
const folderOf = (path: string) => {
  const parts = path.split(/[\\/]/);
  return parts.length > 1 ? parts.slice(-2, -1)[0]! : '';
};
const slots = (n: Node) =>
  n.limits.transcodeCpu + n.limits.transcodeGpu + n.limits.healthCheckCpu + n.limits.healthCheckGpu;

export function TdarrPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const search = useSearch({ from: '/tdarr' });
  const navigate = useNavigate({ from: '/tdarr' });
  const data = useQuery({
    queryKey: ['tdarr'],
    queryFn: () => api<{ instances: TdarrView[] }>('/api/tdarr'),
    refetchInterval: 30_000,
  });
  const reload = useMutation({
    mutationFn: () => api<{ instances: TdarrView[] }>('/api/tdarr?refresh=1'),
    onSuccess: (fresh) => client.setQueryData(['tdarr'], fresh),
  });
  const list = data.data?.instances ?? [];
  const current = list.find((i) => i.instanceId === search.instance) ?? list[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          current
            ? [current.instanceName, current.version ? `v${current.version}` : null]
                .filter(Boolean)
                .join(' · ')
            : t('adapters.category.transcoder')
        }
        title={t('ui.tdarr.title')}
        intro={t('ui.tdarr.intro')}
        actions={
          <>
            {current?.webUrl ? (
              <a
                href={current.webUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text"
              >
                {t('ui.tdarr.open')}
              </a>
            ) : null}
            <Button busy={reload.isPending} onClick={() => reload.mutate()}>
              {t('ui.tdarr.reload')}
            </Button>
          </>
        }
      />
      {data.isError ? (
        <InlineError {...errorText(t, data.error)} onRetry={() => void data.refetch()} />
      ) : null}
      {reload.isError ? <InlineError {...errorText(t, reload.error)} /> : null}

      {list.length > 1 ? (
        <InstanceChips
          label={t('ui.tdarr.instances')}
          current={current?.instanceId}
          onPick={(id) => void navigate({ search: { instance: id }, replace: true })}
          items={list.map((i) => ({
            id: i.instanceId,
            name: i.instanceName,
            adapter: i.adapter,
            tone: STATUS_TONE[i.status],
            count:
              (i.totals?.failed.transcode ?? 0) + (i.totals?.failed.healthCheck ?? 0) + i.offline.length ||
              undefined,
          }))}
        />
      ) : null}

      {data.isPending ? (
        <div className="flex flex-col gap-4" aria-busy>
          <Skeleton className="h-60 rounded-[var(--radius-card)]" />
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 rounded-[var(--radius-card)]" />
            ))}
          </div>
        </div>
      ) : !current ? (
        <Card>
          <EmptyState
            title={t('ui.tdarr.none')}
            body={t('ui.tdarr.noneBody')}
            action={
              <Link to="/settings" search={{ section: 'instances' }}>
                <Button variant="primary">{t('ui.tdarr.add')}</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <ViewTransition view={current.instanceId}>
          <InstanceView view={current} />
        </ViewTransition>
      )}
    </div>
  );
}

function InstanceView({ view }: { view: TdarrView }) {
  const { t, i18n } = useTranslation();
  if (view.status === 'down' || view.status === 'disabled' || !view.totals) {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <StatusDot tone={STATUS_TONE[view.status]} label={t(`ui.status.${view.status}`)} />
          <div>
            <p className="font-medium">
              {view.status === 'disabled'
                ? t('ui.tdarr.disabled', { name: view.instanceName })
                : t('ui.tdarr.unreachable', { name: view.instanceName })}
            </p>
            <p className="text-sm text-muted">
              {view.errorKind ? t(`ui.instance.testFailed.${view.errorKind}`) : null}{' '}
              {t('ui.tdarr.checked', { when: formatRelative(view.checkedAt, i18n.language) })}
            </p>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <Hero view={view} totals={view.totals} />
      <Kpis view={view} totals={view.totals} />
      <NodesSection view={view} />
      <div className="grid gap-4 lg:grid-cols-5">
        <HistoryCard history={view.history} />
        <LibrariesCard view={view} />
      </div>
      <FailuresSection view={view} />
    </div>
  );
}

// ------------------------------------------------------------------ hero

function Hero({ view, totals }: { view: TdarrView; totals: Totals }) {
  const { t, i18n } = useTranslation();
  const n = new Intl.NumberFormat(i18n.language);
  const busy = view.nodes.reduce((sum, node) => sum + node.workers.length, 0);
  const queued = totals.queued.transcode + totals.queued.healthCheck;
  const failed = totals.failed.transcode + totals.failed.healthCheck;
  const paused = view.nodes.filter((x) => x.paused).length;
  const sentence =
    view.nodes.length === 0
      ? t('ui.tdarr.heroNoNodes')
      : busy > 0
        ? t('ui.tdarr.heroBusy', { count: busy, nodes: view.nodes.length, queued: n.format(queued) })
        : queued > 0
          ? t('ui.tdarr.heroWaiting', { count: queued })
          : t('ui.tdarr.heroIdle');
  // Cumulative space saved over the last 30 days, ending at today's total.
  const added = view.history.map((d) => d.savedBytes);
  const sum = added.reduce((a, b) => a + b, 0);
  const start = totals.savedBytes - sum;
  const cumulative = added.map((_, i) => start + added.slice(0, i + 1).reduce((a, x) => a + x, 0));
  const ring: RingSegment[] = [
    {
      key: 'busy',
      value: view.nodes.filter((x) => !x.paused && x.workers.length).length,
      tone: 'ok',
      label: t('ui.tdarr.nodeState.busy'),
    },
    {
      key: 'idle',
      value: view.nodes.filter((x) => !x.paused && !x.workers.length).length,
      tone: 'info',
      label: t('ui.tdarr.nodeState.idle'),
    },
    { key: 'paused', value: paused, tone: 'neutral', label: t('ui.tdarr.nodeState.paused') },
    { key: 'offline', value: view.offline.length, tone: 'critical', label: t('ui.tdarr.nodeState.offline') },
  ];
  const all = view.nodes.length + view.offline.length;
  const files = Math.max(1, totals.files);
  const done = totals.done.transcode;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <Card as="div" className="flex flex-col gap-6 sm:flex-row sm:items-center sm:p-7">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
            {t('ui.tdarr.saved')}
          </span>
          <span className="text-6xl leading-none font-bold tracking-tight">
            <Odometer text={formatBytes(Math.max(0, totals.savedBytes))} />
          </span>
          <p className="text-base font-medium text-balance">{sentence}</p>
          {cumulative.some((v) => v !== cumulative[0]) ? (
            <div className="max-w-md">
              <Sparkline
                values={cumulative.map((v) => Math.max(0, v))}
                height={44}
                format={formatBytes}
                pointLabel={(i) => view.history[i]?.day ?? ''}
                label={t('ui.tdarr.savedTrend')}
              />
            </div>
          ) : null}
          <div className="max-w-md">
            <SegmentBar
              label={t('ui.tdarr.libraryState')}
              format={(v) => n.format(v)}
              segments={[
                { key: 'done', label: t('ui.tdarr.state.done'), value: done, tone: 'ok' },
                {
                  key: 'queued',
                  label: t('ui.tdarr.state.queued'),
                  value: totals.queued.transcode,
                  tone: 'info',
                },
                {
                  key: 'failed',
                  label: t('ui.tdarr.state.failed'),
                  value: totals.failed.transcode,
                  tone: 'critical',
                },
              ]}
            />
            <p className="mt-1.5 text-xs text-muted">
              {t('ui.tdarr.libraryLine', {
                files: n.format(totals.files),
                share: Math.round((done / files) * 100),
                failed: n.format(failed),
              })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-3 self-center">
          <Ring segments={ring} size={168} label={t('ui.tdarr.nodesRing', { count: all })}>
            <span className="flex flex-col items-center leading-tight">
              <span className="text-3xl font-semibold tabular-nums">{view.nodes.length}</span>
              <span className="text-xs text-muted">{t('ui.tdarr.ofNodes', { count: all })}</span>
            </span>
          </Ring>
          <ul className="flex flex-wrap justify-center gap-2">
            {ring
              .filter((s) => s.value > 0)
              .map((s) => (
                <li
                  key={s.key}
                  className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium"
                >
                  <StatusDot tone={s.tone as Tone} label={s.label} />
                  <span className="tabular-nums">{s.value}</span>
                  <span className="text-muted">{s.label}</span>
                </li>
              ))}
          </ul>
        </div>
      </Card>
    </motion.div>
  );
}

function Kpis({ view, totals }: { view: TdarrView; totals: Totals }) {
  const { t, i18n } = useTranslation();
  const n = new Intl.NumberFormat(i18n.language);
  const recent = view.history.slice(-14);
  const week = (key: 'transcodes' | 'healthChecks' | 'failed') =>
    view.history.slice(-7).reduce((s, d) => s + d[key], 0);
  const failed = totals.failed.transcode + totals.failed.healthCheck;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <KpiCard
        label={t('ui.tdarr.transcodes')}
        value={<Odometer text={n.format(totals.transcodes)} />}
        sub={t('ui.tdarr.lastWeek', { count: week('transcodes') })}
        chart={
          <MiniBars
            values={recent.map((d) => d.transcodes)}
            label={t('ui.tdarr.perDay', { label: t('ui.tdarr.transcodes') })}
          />
        }
      />
      <KpiCard
        delay={0.05}
        label={t('ui.tdarr.healthChecks')}
        value={<Odometer text={n.format(totals.healthChecks)} />}
        sub={t('ui.tdarr.lastWeek', { count: week('healthChecks') })}
        chart={
          <MiniBars
            values={recent.map((d) => d.healthChecks)}
            label={t('ui.tdarr.perDay', { label: t('ui.tdarr.healthChecks') })}
          />
        }
      />
      <KpiCard
        delay={0.1}
        label={t('ui.tdarr.failed')}
        tone={failed > 0 ? 'critical' : 'ok'}
        value={<Odometer text={n.format(failed)} />}
        sub={
          failed === 0
            ? t('ui.tdarr.noFailures')
            : t('ui.tdarr.failedSplit', {
                transcode: totals.failed.transcode,
                healthCheck: totals.failed.healthCheck,
              })
        }
        chart={
          <MiniBars
            tone={failed > 0 ? 'critical' : 'ok'}
            values={recent.map((d) => d.failed)}
            label={t('ui.tdarr.perDay', { label: t('ui.tdarr.failed') })}
          />
        }
      />
    </div>
  );
}

// ------------------------------------------------------------------ nodes

function NodesSection({ view }: { view: TdarrView }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <SectionRule>{t('ui.tdarr.nodes')}</SectionRule>
      {view.nodes.length === 0 && view.offline.length === 0 ? (
        <Card>
          <EmptyState title={t('ui.tdarr.noNodes')} body={t('ui.tdarr.noNodesBody')} />
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {view.nodes.map((node, i) => (
            <NodeCard key={node.id} node={node} index={i} />
          ))}
          {view.offline.map((node) => (
            <OfflineNode key={node.id} name={node.name} lastSeenAt={node.lastSeenAt} />
          ))}
        </div>
      )}
    </section>
  );
}

function Meter({ label, value, display }: { label: string; value: number | null; display: string }) {
  if (value === null) return null;
  const tone = value >= 0.95 ? 'critical' : value >= 0.85 ? 'warning' : 'accent';
  return <BarRow label={label} value={value} max={1} display={display} tone={tone} />;
}

function NodeCard({ node, index }: { node: Node; index: number }) {
  const { t } = useTranslation();
  const total = slots(node);
  const busy = node.workers.length;
  const tone: Tone = node.paused ? 'neutral' : busy ? 'ok' : 'info';
  const mem =
    node.memoryUsedBytes !== null && node.memoryTotalBytes
      ? node.memoryUsedBytes / node.memoryTotalBytes
      : null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: index * 0.05 }}
      className="min-w-0"
    >
      <Card as="article" className="flex h-full flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {busy && !node.paused ? (
              <LiveDot tone="ok" label={t('ui.tdarr.nodeState.busy')} />
            ) : (
              <StatusDot tone={tone} label={t(`ui.tdarr.nodeState.${node.paused ? 'paused' : 'idle'}`)} />
            )}
            <h3 className="truncate font-semibold">{node.name}</h3>
          </div>
          {node.paused ? <Badge tone="neutral">{t('ui.tdarr.nodeState.paused')}</Badge> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <SegmentBar
            label={t('ui.tdarr.slots', { busy, total })}
            segments={[
              { key: 'busy', label: t('ui.tdarr.slotBusy'), value: busy, tone: 'accent' },
              {
                key: 'free',
                label: t('ui.tdarr.slotFree'),
                value: Math.max(0, total - busy),
                tone: 'neutral',
                shade: 0.35,
              },
            ]}
          />
          <p className="text-xs text-muted">
            {t('ui.tdarr.slots', { busy, total })} ·{' '}
            {t('ui.tdarr.limits', {
              transcode: node.limits.transcodeCpu + node.limits.transcodeGpu,
              gpu: node.limits.transcodeGpu,
              check: node.limits.healthCheckCpu + node.limits.healthCheckGpu,
            })}
          </p>
        </div>
        {node.cpuPercent !== null || mem !== null ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Meter
              label={t('ui.tdarr.cpu')}
              value={node.cpuPercent === null ? null : node.cpuPercent / 100}
              display={`${Math.round(node.cpuPercent ?? 0)} %`}
            />
            <Meter
              label={t('ui.tdarr.memory')}
              value={mem}
              display={`${formatBytes(node.memoryUsedBytes)} / ${formatBytes(node.memoryTotalBytes)}`}
            />
          </div>
        ) : null}
        {node.workers.length ? (
          <ul className="flex flex-col divide-y divide-border">
            {node.workers.map((w) => (
              <WorkerRow key={w.id} worker={w} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            {node.paused ? t('ui.tdarr.pausedBody') : t('ui.tdarr.idleBody')}
          </p>
        )}
      </Card>
    </motion.div>
  );
}

function WorkerRow({ worker: w }: { worker: Worker }) {
  const { t } = useTranslation();
  const pct = Math.round(w.progress * 100);
  const stuck = w.stuckMinutes !== null;
  const facts = [
    w.fps ? t('ui.tdarr.fps', { fps: Math.round(w.fps) }) : null,
    w.eta && !stuck ? t('ui.tdarr.eta', { eta: w.eta }) : null,
    w.originalBytes
      ? w.estimatedBytes
        ? `${formatBytes(w.originalBytes)} → ${formatBytes(w.estimatedBytes)}`
        : formatBytes(w.originalBytes)
      : null,
  ].filter(Boolean);
  return (
    <li className="flex items-center gap-3 py-2.5">
      <ProgressRing
        value={w.progress}
        tone={stuck ? 'warning' : 'accent'}
        label={t('ui.tdarr.progress', { file: w.file ? baseName(w.file) : '', pct })}
      >
        <span className="text-[10px] font-semibold tabular-nums">{pct}</span>
      </ProgressRing>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={w.file ?? undefined}>
          {w.file ? baseName(w.file) : t('ui.tdarr.unknownFile')}
        </p>
        <p className="truncate text-xs text-muted">
          {[t(`ui.tdarr.kind.${w.kind}`), w.gpu ? 'GPU' : 'CPU', ...facts].join(' · ')}
        </p>
      </div>
      {stuck ? <Badge tone="warning">{t('ui.tdarr.stuck', { minutes: w.stuckMinutes })}</Badge> : null}
    </li>
  );
}

function OfflineNode({ name, lastSeenAt }: { name: string; lastSeenAt: string }) {
  const { t, i18n } = useTranslation();
  return (
    <Card as="article" className="flex items-center gap-3">
      <StatusDot tone="critical" label={t('ui.tdarr.nodeState.offline')} />
      <div className="min-w-0">
        <h3 className="truncate font-semibold">{name}</h3>
        <p className="text-sm text-critical">
          {t('ui.tdarr.offlineSince', { when: formatRelative(lastSeenAt, i18n.language) })}
        </p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- history

function HistoryCard({ history }: { history: Day[] }) {
  const { t, i18n } = useTranslation();
  const day = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const data: ColumnDatum[] = history.map((d) => ({
    key: d.day,
    label: day.format(new Date(`${d.day}T00:00:00Z`)),
    parts: [
      { tone: 'ok', value: d.transcodes + d.healthChecks, label: t('ui.tdarr.finished') },
      { tone: 'critical', value: d.failed, label: t('ui.tdarr.state.failed') },
    ],
  }));
  return (
    <Card className="lg:col-span-3">
      <h2 className="mb-1 text-sm font-semibold tracking-wide text-muted uppercase">
        {t('ui.tdarr.history')}
      </h2>
      <p className="mb-3 text-xs text-muted">{t('ui.tdarr.historyHint')}</p>
      <Columns
        data={data}
        height={160}
        label={t('ui.tdarr.history')}
        emptyLabel={t('ui.tdarr.historyEmpty')}
      />
      <ul className="mt-3 flex gap-4 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <StatusDot tone="ok" label={t('ui.tdarr.finished')} />
          {t('ui.tdarr.finished')}
        </li>
        <li className="flex items-center gap-1.5">
          <StatusDot tone="critical" label={t('ui.tdarr.state.failed')} />
          {t('ui.tdarr.state.failed')}
        </li>
      </ul>
    </Card>
  );
}

function LibrariesCard({ view }: { view: TdarrView }) {
  const { t, i18n } = useTranslation();
  const n = new Intl.NumberFormat(i18n.language);
  const libs = [...(view.libraries ?? [])].sort((a, b) => (b.savedBytes ?? 0) - (a.savedBytes ?? 0));
  const max = Math.max(1, ...libs.map((l) => l.savedBytes ?? 0));
  return (
    <Card className="lg:col-span-2">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">
        {t('ui.tdarr.libraries')}
      </h2>
      {view.libraries === null ? (
        view.detailError ? (
          <p className="text-sm text-muted">
            {t('ui.tdarr.detailFailed', { reason: t(`ui.instance.testFailed.${view.detailError}`) })}
          </p>
        ) : (
          <Skeleton className="h-32" />
        )
      ) : libs.length === 0 ? (
        <p className="text-sm text-muted">{t('ui.tdarr.noLibraries')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {libs.map((l, i) => (
            <BarRow
              key={l.id}
              delay={i * 0.05}
              label={l.name}
              value={Math.max(0, l.savedBytes ?? 0)}
              max={max}
              display={[
                l.savedBytes !== null
                  ? t('ui.tdarr.savedShort', { size: formatBytes(Math.max(0, l.savedBytes)) })
                  : null,
                l.files !== null
                  ? t('ui.tdarr.files', { count: l.files, formatted: n.format(l.files) })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

// --------------------------------------------------------------- failures

function FailuresSection({ view }: { view: TdarrView }) {
  const { t, i18n } = useTranslation();
  const list = view.failures ?? [];
  const total = (view.totals?.failed.transcode ?? 0) + (view.totals?.failed.healthCheck ?? 0);
  return (
    <section className="flex flex-col gap-4">
      <SectionRule
        action={
          view.webUrl && total > 0 ? (
            <a
              href={view.webUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="shrink-0 text-sm text-accent hover:underline"
            >
              {t('ui.tdarr.openErrors')}
            </a>
          ) : undefined
        }
      >
        {t('ui.tdarr.failures')}
      </SectionRule>
      <Card className="!p-0">
        {total === 0 ? (
          <EmptyState title={t('ui.tdarr.noFailuresTitle')} body={t('ui.tdarr.noFailuresBody')} />
        ) : view.failures === null ? (
          <p className="px-5 py-4 text-sm text-muted">
            {view.detailError
              ? t('ui.tdarr.detailFailed', { reason: t(`ui.instance.testFailed.${view.detailError}`) })
              : t('ui.tdarr.failuresCount', { count: total })}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {list.map((f, i) => (
                <motion.li
                  key={`${f.kind}:${f.file}`}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...spring, delay: 0.05 + Math.min(i, 10) * 0.03 }}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  <StatusDot
                    tone={f.outcome === 'cancelled' ? 'neutral' : 'critical'}
                    label={t(`ui.tdarr.outcome.${f.outcome}`)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={f.file}>
                      {baseName(f.file)}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {[
                        folderOf(f.file),
                        f.sizeBytes ? formatBytes(f.sizeBytes) : null,
                        f.at ? formatRelative(f.at, i18n.language) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <Badge tone={f.kind === 'healthCheck' ? 'warning' : 'critical'}>
                    {t(`ui.tdarr.failedKind.${f.kind}`)}
                  </Badge>
                </motion.li>
              ))}
            </ul>
            {total > list.length ? (
              <p className="border-t border-border px-5 py-3 text-xs text-muted">
                {t('ui.tdarr.moreFailures', { count: total - list.length })}
              </p>
            ) : null}
          </>
        )}
      </Card>
    </section>
  );
}
