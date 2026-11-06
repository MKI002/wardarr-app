// Read-only queue view per instance. Cleaning actions come in stage 2.
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Badge, Card, InlineError, ProgressBar, Skeleton, type Tone } from '../components/ui';
import { api } from '../lib/api';
import { formatBytes, formatRelative } from '../lib/format';

interface QueueInstance {
  instanceId: string;
  instanceName: string;
  adapter: string;
  adapterName: string;
  checkedAt: string | null;
  items: Array<{
    id: number;
    title: string;
    state: string;
    matched: boolean;
    statusMessages: string[];
    errorMessage?: string;
    sizeBytes?: number;
    sizeLeftBytes?: number;
    downloadClient?: string;
  }>;
}

const STATE_TONE: Record<string, Tone> = {
  failed: 'critical',
  importBlocked: 'warning',
  warning: 'warning',
  importPending: 'info',
  downloading: 'ok',
  completed: 'ok',
};

export function QueuePage() {
  const { t, i18n } = useTranslation();
  const search = useSearch({ from: '/queue' });
  const navigate = useNavigate({ from: '/queue' });
  const all = useQuery({
    queryKey: ['queue'],
    queryFn: () => api<QueueInstance[]>('/api/queue'),
    refetchInterval: 30_000,
  });
  const list = (all.data ?? []).filter((q) => !search.instance || q.instanceId === search.instance);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('ui.queue.title')}</h1>
          <p className="text-sm text-muted">{t('ui.queue.readOnly')}</p>
        </div>
        {all.data && all.data.length > 1 ? (
          <select
            aria-label={t('ui.queue.title')}
            className="min-h-9 rounded-lg border border-border bg-surface px-3 text-sm"
            value={search.instance ?? ''}
            onChange={(e) => void navigate({ search: { instance: e.target.value || undefined } })}
          >
            <option value="">{t('ui.queue.allInstances')}</option>
            {all.data.map((q) => (
              <option key={q.instanceId} value={q.instanceId}>
                {q.instanceName}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {all.isError ? (
        <InlineError message={t('ui.errors.loadFailed')} onRetry={() => void all.refetch()} />
      ) : null}
      {all.isPending ? <Skeleton className="h-48 rounded-[var(--radius-card)]" /> : null}
      {list.map((q) => (
        <Card key={q.instanceId}>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="font-semibold">
              {q.instanceName} <span className="text-sm font-normal text-muted">{q.adapterName}</span>
            </h2>
            <span className="text-xs text-muted">
              {q.checkedAt
                ? t('ui.overview.checked', { when: formatRelative(q.checkedAt, i18n.language) })
                : t('ui.queue.notChecked')}
            </span>
          </div>
          {q.items.length === 0 ? (
            <p className="text-sm text-muted">{t('ui.queue.empty')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {q.items.map((item) => {
                const done =
                  item.sizeBytes && item.sizeLeftBytes !== undefined
                    ? 1 - item.sizeLeftBytes / item.sizeBytes
                    : null;
                return (
                  <li key={item.id} className="flex flex-col gap-1.5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={STATE_TONE[item.state] ?? 'neutral'}>
                        {t(`ui.queue.state.${item.state}`, { defaultValue: item.state })}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={item.title}>
                        {item.title}
                      </span>
                      {!item.matched ? <Badge tone="warning">{t('ui.queue.unmatched')}</Badge> : null}
                    </div>
                    {item.errorMessage || item.statusMessages.length > 0 ? (
                      <p className="text-xs break-words text-muted">
                        {[item.errorMessage, ...item.statusMessages].filter(Boolean).join(' · ')}
                      </p>
                    ) : null}
                    <div className="flex gap-3 text-xs text-muted">
                      {item.downloadClient ? (
                        <span>
                          {t('ui.queue.client')}: {item.downloadClient}
                        </span>
                      ) : null}
                      {item.sizeBytes ? (
                        <span>
                          {t('ui.queue.size')}: {formatBytes(item.sizeBytes)}
                        </span>
                      ) : null}
                    </div>
                    {done !== null && item.state === 'downloading' ? (
                      <ProgressBar value={done} tone="ok" label={item.title} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}
