// Preview of a sync: every change per object and field, where it comes from,
// and the confirmed sync with a backup taken first.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import {
  ORIGIN_TONE,
  STATUS_TONE,
  showValue,
  type HistoryEntry,
  type Preview,
  type SyncPlan,
  type TrashInstance,
} from '../../lib/trash';
import { Dialog } from '../Dialog';
import { Badge, Button, InlineError, Skeleton, Toggle, type Tone } from '../ui';

type ObjectPlan = SyncPlan['objects'][number];

const ACTION_TONE: Record<ObjectPlan['action'], Tone> = {
  create: 'ok',
  update: 'info',
  remove: 'critical',
  unchanged: 'neutral',
};
const KINDS: ObjectPlan['kind'][] = ['qualityProfile', 'customFormat', 'qualitySize', 'naming'];

function ObjectRow({ o }: { o: ObjectPlan }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const fields = o.changes.length;
  return (
    <li className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
        disabled={fields === 0}
        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm"
      >
        <Badge tone={ACTION_TONE[o.action]}>{t(`trash.action.${o.action}`)}</Badge>
        <span className="min-w-0 flex-1 truncate font-medium">
          {o.kind === 'qualitySize'
            ? t('trash.kind.qualitySize')
            : o.kind === 'naming'
              ? t('trash.kind.naming')
              : o.label}
        </span>
        {o.adopted ? <Badge tone="neutral">{t('trash.preview.adopted')}</Badge> : null}
        {fields ? (
          <span className="text-xs text-muted tabular-nums">
            {t('trash.preview.fields', { count: fields })}
          </span>
        ) : null}
      </button>
      {open && fields ? (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-xs">
            <thead className="text-left text-muted">
              <tr>
                <th className="px-3 py-1.5 font-medium">{t('trash.preview.field')}</th>
                <th className="px-3 py-1.5 font-medium">{t('trash.preview.before')}</th>
                <th className="px-3 py-1.5 font-medium">{t('trash.preview.after')}</th>
                <th className="px-3 py-1.5 font-medium">{t('trash.preview.origin')}</th>
              </tr>
            </thead>
            <tbody>
              {o.changes.map((c) => (
                <tr key={c.field} className="border-t border-border align-top">
                  <td className="px-3 py-1.5 font-medium">
                    {c.field.startsWith('score:')
                      ? t('trash.preview.score', { name: c.label ?? c.field })
                      : t(`trash.field.${c.field}`, { defaultValue: c.field })}
                  </td>
                  <td className="max-w-64 px-3 py-1.5 break-words text-muted">{showValue(c.before)}</td>
                  <td className="max-w-64 px-3 py-1.5 break-words">{showValue(c.after)}</td>
                  <td className="px-3 py-1.5">
                    <Badge tone={ORIGIN_TONE[c.origin]}>{t(`trash.origin.${c.origin}`)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </li>
  );
}

export function PreviewDialog({
  instance,
  open,
  onOpenChange,
}: {
  instance: TrashInstance;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [removals, setRemovals] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const preview = useQuery({
    queryKey: ['trash', 'preview', instance.id],
    queryFn: () => api<Preview>(`/api/trash/instances/${encodeURIComponent(instance.id)}/preview`),
    enabled: open,
    staleTime: 0,
  });
  const sync = useMutation({
    mutationFn: () =>
      api<{ entry: HistoryEntry }>(`/api/trash/instances/${encodeURIComponent(instance.id)}/sync`, {
        method: 'POST',
        body: { confirm: true, removals },
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['trash'] }),
  });
  const plan = preview.data?.plan;
  const pending = plan ? plan.counts.create + plan.counts.update + (removals ? plan.counts.remove : 0) : 0;
  const result = sync.data?.entry;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) sync.reset();
        onOpenChange(o);
      }}
      title={t('trash.preview.title', { instance: instance.name })}
      description={
        preview.data ? t('trash.preview.subtitle', { template: preview.data.template.name }) : undefined
      }
      wide
    >
      <div className="flex flex-col gap-4">
        {preview.isPending ? <Skeleton className="h-48" /> : null}
        {preview.isError ? (
          <InlineError {...errorText(t, preview.error)} onRetry={() => void preview.refetch()} />
        ) : null}
        {result ? (
          <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3 text-sm" role="status">
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[result.status]}>{t(`trash.status.${result.status}`)}</Badge>
              <span>
                {t('trash.preview.done', {
                  count:
                    (result.summary.counts?.create ?? 0) +
                    (result.summary.counts?.update ?? 0) +
                    (result.summary.counts?.remove ?? 0),
                })}
              </span>
            </div>
            {result.error ? <p className="text-critical">{result.error}</p> : null}
            {result.hasBackup ? <p className="text-muted">{t('trash.preview.backupKept')}</p> : null}
          </div>
        ) : null}
        {plan && !result ? (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge tone="ok">{t('trash.preview.countCreate', { count: plan.counts.create })}</Badge>
              <Badge tone="info">{t('trash.preview.countUpdate', { count: plan.counts.update })}</Badge>
              {plan.counts.remove ? (
                <Badge tone="critical">{t('trash.preview.countRemove', { count: plan.counts.remove })}</Badge>
              ) : null}
              <Badge tone="neutral">
                {t('trash.preview.countUnchanged', { count: plan.counts.unchanged })}
              </Badge>
            </div>
            {preview.data!.neverSynced ? (
              <p className="text-sm text-muted">{t('trash.preview.firstSync')}</p>
            ) : null}
            {plan.warnings.length ? (
              <ul className="flex flex-col gap-1 rounded-lg bg-warning-bg p-3 text-sm text-warning">
                {plan.warnings.map((w, i) => (
                  <li key={i}>{t(`trash.warning.${w.code}`, w.params)}</li>
                ))}
              </ul>
            ) : null}
            {preview.data!.brakes.length ? (
              <p className="rounded-lg bg-info-bg p-3 text-sm text-info">
                {t('trash.preview.brakes', {
                  reasons: preview
                    .data!.brakes.map((b) => t(`issues.trashSyncPaused.reason.${b}`))
                    .join(', '),
                })}
              </p>
            ) : null}
            {pending === 0 && !plan.counts.remove ? (
              <p className="rounded-lg bg-ok-bg p-3 text-sm text-ok">{t('trash.preview.inSync')}</p>
            ) : null}
            {KINDS.map((kind) => {
              const list = plan.objects.filter(
                (o) => o.kind === kind && (showUnchanged || o.action !== 'unchanged'),
              );
              if (!list.length) return null;
              return (
                <section key={kind} className="flex flex-col gap-2">
                  <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
                    {t(`trash.kindPlural.${kind}`)}
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {list.map((o) => (
                      <ObjectRow key={o.key} o={o} />
                    ))}
                  </ul>
                </section>
              );
            })}
            {plan.counts.unchanged ? (
              <Button variant="ghost" className="self-start" onClick={() => setShowUnchanged((x) => !x)}>
                {showUnchanged
                  ? t('trash.preview.hideUnchanged')
                  : t('trash.preview.showUnchanged', { count: plan.counts.unchanged })}
              </Button>
            ) : null}
            {plan.counts.remove ? (
              <Toggle
                label={t('trash.preview.removals')}
                help={t('trash.preview.removalsHelp')}
                checked={removals}
                onChange={setRemovals}
              />
            ) : null}
            {sync.isError ? <InlineError {...errorText(t, sync.error)} /> : null}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
              <p className="mr-auto text-xs text-muted">{t('trash.preview.backupNote')}</p>
              <Button onClick={() => onOpenChange(false)}>{t('ui.common.cancel')}</Button>
              <Button
                variant="primary"
                disabled={pending === 0}
                busy={sync.isPending}
                onClick={() => sync.mutate()}
              >
                {t('trash.preview.apply', { count: pending })}
              </Button>
            </div>
          </>
        ) : null}
        {result ? (
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              {t('ui.common.close')}
            </Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
