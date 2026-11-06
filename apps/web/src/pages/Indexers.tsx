// Indexers: Prowlarr status, statistics, tests, and which apps lose search
// coverage when an indexer fails.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InlineError,
  SectionTitle,
  Skeleton,
  StatusDot,
  spring,
} from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatRelative } from '../lib/format';

interface IndexerRow {
  id: number;
  name: string;
  enabled: boolean;
  protocol: 'usenet' | 'torrent' | 'unknown';
  failing: boolean;
  disabledUntil?: string;
  mostRecentFailure?: string;
  stats: {
    queries: number;
    grabs: number;
    failedQueries: number;
    failedGrabs: number;
    averageResponseMs: number | null;
  } | null;
  apps: string[];
  stranded: string[];
  webUrl: string | null;
}

interface ProwlarrView {
  instanceId: string;
  instanceName: string;
  adapterName: string;
  status: string;
  checkedAt: string | null;
  error: string | null;
  indexers: IndexerRow[];
  apps: Array<{
    id: number;
    name: string;
    implementation: string;
    enabled: boolean;
    indexerIds: number[];
    failing: string[];
  }>;
}

export function IndexersPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const data = useQuery({
    queryKey: ['indexers'],
    queryFn: () => api<{ instances: ProwlarrView[] }>('/api/indexers'),
    refetchInterval: 60_000,
  });
  const reload = useMutation({
    mutationFn: () => api<{ instances: ProwlarrView[] }>('/api/indexers?refresh=1'),
    onSuccess: (fresh) => client.setQueryData(['indexers'], fresh),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('ui.indexers.title')}</h1>
          <p className="text-sm text-muted">{t('ui.indexers.intro')}</p>
        </div>
        <Button busy={reload.isPending} onClick={() => reload.mutate()}>
          {t('ui.indexers.reload')}
        </Button>
      </div>
      {data.isError ? (
        <InlineError {...errorText(t, data.error)} onRetry={() => void data.refetch()} />
      ) : null}
      {reload.isError ? <InlineError {...errorText(t, reload.error)} /> : null}
      {data.isPending ? (
        <Skeleton className="h-64 rounded-[var(--radius-card)]" />
      ) : data.data?.instances.length === 0 ? (
        <Card>
          <EmptyState title={t('ui.indexers.none')} body={t('ui.indexers.noneBody')} />
        </Card>
      ) : (
        data.data?.instances.map((inst) => <ProwlarrCard key={inst.instanceId} inst={inst} />)
      )}
    </div>
  );
}

function ProwlarrCard({ inst }: { inst: ProwlarrView }) {
  const { t, i18n } = useTranslation();
  const failing = inst.indexers.filter((i) => i.failing).length;
  const sorted = [...inst.indexers].sort(
    (a, b) =>
      Number(b.failing) - Number(a.failing) ||
      Number(b.enabled) - Number(a.enabled) ||
      a.name.localeCompare(b.name),
  );
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{inst.instanceName}</h2>
        <p className="text-xs text-muted">
          {t('ui.indexers.summary', { count: inst.indexers.length, failing })} ·{' '}
          {formatRelative(inst.checkedAt, i18n.language)}
        </p>
      </div>
      {inst.error ? (
        <InlineError
          message={t('ui.indexers.statsFailed', { reason: t(`ui.instance.testFailed.${inst.error}`) })}
        />
      ) : null}

      {inst.apps.length > 0 ? (
        <Card>
          <SectionTitle>{t('ui.indexers.apps')}</SectionTitle>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {inst.apps.map((app) => {
              const working = app.indexerIds.length - app.failing.length;
              const tone = !app.enabled
                ? 'neutral'
                : working <= 0 && app.indexerIds.length
                  ? 'critical'
                  : app.failing.length
                    ? 'warning'
                    : 'ok';
              return (
                <li key={app.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
                  <span className="mt-1.5">
                    <StatusDot tone={tone} label={t(`ui.indexers.appTone.${tone}`)} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{app.name}</p>
                    <p className="text-xs text-muted">
                      {!app.enabled
                        ? t('ui.indexers.appDisabled')
                        : t('ui.indexers.appIndexers', {
                            count: app.indexerIds.length,
                            working: Math.max(0, working),
                          })}
                    </p>
                    {app.failing.length ? (
                      <p className="mt-1 text-xs text-warning">
                        {t('ui.indexers.appFailing', { list: app.failing.join(', ') })}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <Card className="!p-0">
        {sorted.length === 0 ? (
          <EmptyState title={t('ui.indexers.noIndexers')} />
        ) : (
          <ul className="divide-y divide-border">
            {sorted.map((ix) => (
              <IndexerItem key={ix.id} ix={ix} instanceId={inst.instanceId} />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function IndexerItem({ ix, instanceId }: { ix: IndexerRow; instanceId: string }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const test = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; message: string | null }>(
        `/api/indexers/${encodeURIComponent(instanceId)}/${ix.id}/test`,
        { method: 'POST' },
      ),
    onSettled: () => void client.invalidateQueries({ queryKey: ['indexers'] }),
  });
  const n = new Intl.NumberFormat(i18n.language);
  const s = ix.stats;
  const failRate = s && s.queries ? Math.round((s.failedQueries / s.queries) * 100) : null;
  const tone = !ix.enabled ? 'neutral' : ix.failing ? 'critical' : 'ok';
  return (
    <li className="flex flex-col gap-2 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <StatusDot tone={tone} label={t(`ui.indexers.state.${tone}`)} />
          <div className="min-w-0">
            <p className="truncate font-medium">{ix.name}</p>
            <p className="text-xs text-muted">
              {[
                t(`ui.indexers.protocol.${ix.protocol}`),
                ix.apps.length
                  ? t('ui.indexers.usedBy', { list: ix.apps.join(', ') })
                  : t('ui.indexers.unused'),
              ].join(' · ')}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ix.failing ? <Badge tone="critical">{t('ui.indexers.state.critical')}</Badge> : null}
          {!ix.enabled ? <Badge tone="neutral">{t('ui.indexers.state.neutral')}</Badge> : null}
          <Button busy={test.isPending} onClick={() => test.mutate()}>
            {t('ui.indexers.test')}
          </Button>
          {ix.webUrl ? (
            <a
              href={ix.webUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-text"
            >
              {t('ui.indexers.open')}
            </a>
          ) : null}
        </div>
      </div>
      {s ? (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
          <div>
            <dt className="inline">{t('ui.indexers.queries')}: </dt>
            <dd className="inline text-text tabular-nums">{n.format(s.queries)}</dd>
          </div>
          <div>
            <dt className="inline">{t('ui.indexers.grabs')}: </dt>
            <dd className="inline text-text tabular-nums">{n.format(s.grabs)}</dd>
          </div>
          {failRate !== null ? (
            <div>
              <dt className="inline">{t('ui.indexers.failRate')}: </dt>
              <dd className={`inline tabular-nums ${failRate >= 20 ? 'text-warning' : 'text-text'}`}>
                {failRate}%
              </dd>
            </div>
          ) : null}
          {s.averageResponseMs !== null ? (
            <div>
              <dt className="inline">{t('ui.indexers.response')}: </dt>
              <dd className="inline text-text tabular-nums">{n.format(s.averageResponseMs)} ms</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {ix.stranded.length ? (
        <p className="text-sm text-critical">
          {t('ui.indexers.stranded', { list: ix.stranded.join(', '), count: ix.stranded.length })}
        </p>
      ) : null}
      {test.data ? (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          role="status"
          className={`text-sm ${test.data.ok ? 'text-ok' : 'text-critical'}`}
        >
          {test.data.ok ? t('ui.indexers.testOk') : t('ui.indexers.testFailed')}
        </motion.p>
      ) : null}
      {test.isError ? <InlineError {...errorText(t, test.error)} /> : null}
    </li>
  );
}
