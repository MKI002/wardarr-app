// TRaSH Guides: templates built from the guide, pushed to Sonarr and Radarr
// with a preview and a backup, and a guard per instance that watches for
// changes in the guide and in the instance.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../components/Dialog';
import { PreviewDialog } from '../components/trash/PreviewDialog';
import { TemplateEditor, type EditorInput } from '../components/trash/TemplateEditor';
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
  Select,
  Skeleton,
  Tabs,
  TextField,
  type Tone,
} from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatRelative } from '../lib/format';
import {
  STATUS_TONE,
  emptyConfig,
  shortVersion,
  type GuardMode,
  type HistoryEntry,
  type TrashInstance,
  type TrashOverview,
  type TrashProduct,
  type TrashSettings,
  type TrashTemplate,
} from '../lib/trash';

export type TrashTab = 'instances' | 'templates' | 'history' | 'test' | 'settings';
const enc = encodeURIComponent;
const GUARD_MODES: GuardMode[] = ['off', 'notify', 'auto', 'strict'];

function useTrash() {
  return useQuery({
    queryKey: ['trash'],
    queryFn: () => api<TrashOverview>('/api/trash'),
    refetchInterval: 60_000,
  });
}

/** Where an instance stands, as one badge. */
function instanceBadge(i: TrashInstance): { tone: Tone; key: string; count?: number } {
  const s = i.state;
  if (!i.templateId) return { tone: 'neutral', key: 'noTemplate' };
  if (s.error === 'unsupported') return { tone: 'neutral', key: 'unsupported' };
  if (s.error) return { tone: 'critical', key: 'unreachable' };
  if (s.pause) return { tone: 'warning', key: 'paused' };
  if (s.lastSync && s.lastSync.status !== 'ok') return { tone: 'warning', key: 'failed' };
  if (i.neverSynced) return { tone: 'info', key: 'neverSynced' };
  const drift = (s.counts?.guide ?? 0) + (s.counts?.local ?? 0);
  if (i.guardMode === 'off') return { tone: 'neutral', key: 'guardOff' };
  if (drift) return { tone: 'info', key: 'drift', count: drift };
  if (!s.checkedAt) return { tone: 'neutral', key: 'unchecked' };
  return { tone: 'ok', key: 'inSync' };
}

function GuideHeader({ data }: { data: TrashOverview }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const refresh = useMutation({
    mutationFn: () => api<{ changed: boolean }>('/api/trash/guide/refresh', { method: 'POST' }),
    onSettled: () => void client.invalidateQueries({ queryKey: ['trash'] }),
  });
  const g = data.guide;
  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">
          {g.version ? t('trash.guide.version', { version: shortVersion(g.version) }) : t('trash.guide.none')}
        </span>
        <span className="text-xs text-muted">
          {g.date ? t('trash.guide.published', { when: formatRelative(g.date, i18n.language) }) + ' · ' : ''}
          {t('trash.guide.checked', {
            when: g.checkedAt ? formatRelative(g.checkedAt, i18n.language) : t('ui.common.never'),
          })}
        </span>
        {g.error ? <span className="text-xs text-warning">{t('trash.errors.guideFetchFailed')}</span> : null}
        {g.skipped.length ? (
          <span className="text-xs text-muted">{t('trash.guide.skipped', { count: g.skipped.length })}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a
          className="text-sm text-accent hover:underline"
          href="https://trash-guides.info/"
          target="_blank"
          rel="noreferrer noopener"
        >
          trash-guides.info
        </a>
        <Button busy={refresh.isPending} onClick={() => refresh.mutate()}>
          {t('trash.guide.refresh')}
        </Button>
      </div>
      {refresh.isError ? <InlineError {...errorText(t, refresh.error)} /> : null}
      {refresh.data ? (
        <p className="w-full text-xs text-muted" role="status">
          {refresh.data.changed ? t('trash.guide.updated') : t('trash.guide.upToDate')}
        </p>
      ) : null}
    </Card>
  );
}

function InstanceCard({
  instance,
  focused,
  templates,
  onEditTemplate,
}: {
  instance: TrashInstance;
  focused?: boolean;
  templates: TrashTemplate[];
  onEditTemplate: (input: EditorInput) => void;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [preview, setPreview] = useState(false);
  const [arming, setArming] = useState<GuardMode | null>(null);
  const invalidate = () => void client.invalidateQueries({ queryKey: ['trash'] });
  const base = `/api/trash/instances/${enc(instance.id)}`;
  const assign = useMutation({
    mutationFn: (templateId: string | null) =>
      api(`${base}/template`, { method: 'PUT', body: { templateId } }),
    onSuccess: invalidate,
  });
  const guard = useMutation({
    mutationFn: (v: { mode: GuardMode; confirm?: boolean }) =>
      api(`${base}/guard`, { method: 'PUT', body: v }),
    onSuccess: () => {
      setArming(null);
      invalidate();
    },
  });
  const check = useMutation({
    mutationFn: () => api(`${base}/check`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const resume = useMutation({
    mutationFn: () => api(`${base}/resume`, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const suggest = useMutation({
    mutationFn: () =>
      api<{ product: TrashProduct; config: EditorInput['config'] }>(`${base}/suggest`, { method: 'POST' }),
    onSuccess: (res) =>
      onEditTemplate({
        name: t('trash.instances.suggestedName', { name: instance.name }),
        product: res.product,
        config: res.config,
      }),
  });
  const own = templates.filter((x) => x.product === instance.product);
  const badge = instanceBadge(instance);
  const s = instance.state;
  const error = assign.error ?? guard.error ?? check.error ?? suggest.error ?? resume.error;

  return (
    <Card as="li" className={`flex flex-col gap-4 ${focused ? 'ring-2 ring-accent' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{instance.name}</h3>
          <p className="text-xs text-muted">
            {t(`trash.product.${instance.product}`)}
            {instance.version ? ` ${instance.version}` : ''}
            {instance.lastSyncAt
              ? ` · ${t('trash.instances.lastSync', { when: formatRelative(instance.lastSyncAt, i18n.language) })}`
              : ''}
          </p>
        </div>
        <Badge tone={badge.tone}>{t(`trash.badge.${badge.key}`, { count: badge.count ?? 0 })}</Badge>
      </div>
      {s.counts && (s.counts.guide || s.counts.local) ? (
        <p className="text-sm text-muted">
          {[
            s.counts.guide ? t('trash.instances.guideDrift', { count: s.counts.guide }) : null,
            s.counts.local ? t('trash.instances.localDrift', { count: s.counts.local }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
      {s.pause ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-warning-bg px-3 py-2 text-sm text-warning">
          <span className="flex-1">
            {t('trash.instances.paused', {
              reasons: s.pause.reasons.map((r) => t(`issues.trashSyncPaused.reason.${r}`)).join(', '),
            })}
          </span>
          <Button variant="ghost" busy={resume.isPending} onClick={() => resume.mutate()}>
            {t('trash.instances.resume')}
          </Button>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label={t('trash.instances.template')}
          value={instance.templateId ?? ''}
          onChange={(v) => assign.mutate(v || null)}
          options={[
            ['', t('trash.instances.noTemplate')],
            ...own.map((x): [string, string] => [x.id, x.name]),
          ]}
        />
        {instance.templateId ? (
          <Choice
            label={t('trash.instances.guard')}
            value={instance.guardMode}
            options={GUARD_MODES.map((m): [GuardMode, string] => [m, t(`trash.guard.${m}`)])}
            onChange={(mode) =>
              mode === 'auto' || mode === 'strict' ? setArming(mode) : guard.mutate({ mode })
            }
          />
        ) : null}
      </div>
      {instance.templateId ? (
        <p className="text-xs text-muted">{t(`trash.guardHelp.${instance.guardMode}`)}</p>
      ) : null}
      {error ? <InlineError {...errorText(t, error)} /> : null}
      <div className="flex flex-wrap gap-2">
        {instance.templateId ? (
          <>
            <Button variant="primary" onClick={() => setPreview(true)}>
              {t('trash.instances.preview')}
            </Button>
            <Button busy={check.isPending} onClick={() => check.mutate()}>
              {t('trash.instances.check')}
            </Button>
          </>
        ) : null}
        <Button variant="ghost" busy={suggest.isPending} onClick={() => suggest.mutate()}>
          {t('trash.instances.suggest')}
        </Button>
      </div>
      {preview ? <PreviewDialog instance={instance} open={preview} onOpenChange={setPreview} /> : null}
      <ConfirmDialog
        open={arming !== null}
        onOpenChange={(o) => !o && setArming(null)}
        title={t('trash.arm.title', {
          instance: instance.name,
          mode: arming ? t(`trash.guard.${arming}`) : '',
        })}
        body={arming ? t(`trash.arm.body.${arming}`) : ''}
        confirmLabel={t('trash.arm.confirm')}
        busy={guard.isPending}
        onConfirm={() => arming && guard.mutate({ mode: arming, confirm: true })}
      />
    </Card>
  );
}

function InstancesTab({
  data,
  focus,
  onEditTemplate,
}: {
  data: TrashOverview;
  focus?: string;
  onEditTemplate: (i: EditorInput) => void;
}) {
  const { t, i18n } = useTranslation();
  if (!data.instances.length) {
    return (
      <Card>
        <EmptyState title={t('trash.instances.none')} body={t('trash.instances.noneBody')} />
      </Card>
    );
  }
  const products: TrashProduct[] = ['radarr', 'sonarr'];
  return (
    <div className="flex flex-col gap-6">
      {data.templates.length === 0 ? (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">{t('trash.instances.firstTemplate')}</p>
          <Button
            variant="primary"
            onClick={() =>
              onEditTemplate({ name: '', product: data.instances[0]!.product, config: emptyConfig() })
            }
          >
            {t('trash.templates.new')}
          </Button>
        </Card>
      ) : null}
      {products.map((p) => {
        const list = data.instances.filter((i) => i.product === p);
        if (!list.length) return null;
        return (
          <section key={p}>
            <SectionTitle>{t(`trash.product.${p}`)}</SectionTitle>
            <ul className="grid gap-4 lg:grid-cols-2">
              {list.map((i) => (
                <InstanceCard
                  key={i.id}
                  instance={i}
                  focused={i.id === focus}
                  templates={data.templates}
                  onEditTemplate={onEditTemplate}
                />
              ))}
            </ul>
          </section>
        );
      })}
      <section>
        <SectionTitle>{t('trash.changelog.title')}</SectionTitle>
        {data.changelog.length === 0 ? (
          <p className="text-sm text-muted">{t('trash.changelog.empty')}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.changelog.map((entry) => (
              <Disclosure
                key={entry.at}
                title={t('trash.changelog.entry', {
                  when: formatRelative(entry.at, i18n.language),
                  from: shortVersion(entry.from),
                  to: shortVersion(entry.to),
                })}
              >
                {(
                  Object.entries(entry.changes) as Array<
                    [TrashProduct, NonNullable<(typeof entry.changes)['radarr']>]
                  >
                ).map(([product, changes]) => (
                  <div key={product} className="flex flex-col gap-1">
                    <h4 className="text-sm font-medium">{t(`trash.product.${product}`)}</h4>
                    <ul className="flex flex-col gap-0.5 text-sm">
                      {changes.map((c) => (
                        <li key={`${c.kind}:${c.id}`} className="flex flex-wrap items-center gap-2">
                          <Badge
                            tone={c.change === 'added' ? 'ok' : c.change === 'removed' ? 'critical' : 'info'}
                          >
                            {t(`trash.changelog.${c.change}`)}
                          </Badge>
                          <span>{c.name}</span>
                          <span className="text-xs text-muted">
                            {t(`trash.kind.${c.kind}`)}
                            {c.parts?.length ? ` · ${c.parts.join(', ')}` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </Disclosure>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TemplatesTab({ data, onEdit }: { data: TrashOverview; onEdit: (i: EditorInput) => void }) {
  const { t, i18n } = useTranslation();
  const used = (id: string) => data.instances.filter((i) => i.templateId === id).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={() => onEdit({ name: '', product: 'radarr', config: emptyConfig() })}
        >
          {t('trash.templates.new')}
        </Button>
      </div>
      {data.templates.length === 0 ? (
        <Card>
          <EmptyState title={t('trash.templates.none')} body={t('trash.templates.noneBody')} />
        </Card>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {data.templates.map((tpl) => (
            <Card as="li" key={tpl.id} className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{tpl.name}</h3>
                  <p className="text-xs text-muted">
                    {t(`trash.product.${tpl.product}`)} ·{' '}
                    {t('trash.templates.updated', { when: formatRelative(tpl.updatedAt, i18n.language) })}
                  </p>
                </div>
                <Badge tone={used(tpl.id) ? 'info' : 'neutral'}>
                  {t('trash.templates.used', { count: used(tpl.id) })}
                </Badge>
              </div>
              <p className="text-sm text-muted">
                {t('trash.templates.summary', {
                  count: tpl.config.profiles.length,
                  naming: Object.keys(tpl.config.naming).length ? t('trash.templates.withNaming') : '',
                })}
              </p>
              <Button
                className="self-start"
                onClick={() =>
                  onEdit({ id: tpl.id, name: tpl.name, product: tpl.product, config: tpl.config })
                }
              >
                {t('ui.common.edit')}
              </Button>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoryTab({ data }: { data: TrashOverview }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [rollback, setRollback] = useState<HistoryEntry | null>(null);
  const history = useQuery({
    queryKey: ['trash', 'history'],
    queryFn: () => api<{ entries: HistoryEntry[] }>('/api/trash/history?limit=100'),
  });
  const undo = useMutation({
    mutationFn: (id: string) =>
      api(`/api/trash/history/${enc(id)}/rollback`, { method: 'POST', body: { confirm: true } }),
    onSuccess: () => {
      setRollback(null);
      void client.invalidateQueries({ queryKey: ['trash'] });
    },
  });
  void data;
  if (history.isPending) return <Skeleton className="h-40 rounded-[var(--radius-card)]" />;
  if (history.isError)
    return <InlineError {...errorText(t, history.error)} onRetry={() => void history.refetch()} />;
  const entries = history.data.entries;
  if (!entries.length) {
    return (
      <Card>
        <EmptyState title={t('trash.history.none')} body={t('trash.history.noneBody')} />
      </Card>
    );
  }
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">{t('trash.history.when')}</th>
            <th className="px-4 py-2 font-medium">{t('trash.history.instance')}</th>
            <th className="px-4 py-2 font-medium">{t('trash.history.what')}</th>
            <th className="px-4 py-2 font-medium">{t('trash.history.by')}</th>
            <th className="px-4 py-2 font-medium">{t('trash.history.result')}</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const c = e.summary.counts;
            return (
              <tr key={e.id} className="border-t border-border align-top">
                <td className="px-4 py-2 whitespace-nowrap">{formatRelative(e.at, i18n.language)}</td>
                <td className="px-4 py-2">
                  {e.instanceName ?? '—'}
                  {e.templateName ? <div className="text-xs text-muted">{e.templateName}</div> : null}
                </td>
                <td className="px-4 py-2">
                  {e.kind === 'rollback'
                    ? t('trash.history.rollback', { count: e.summary.restored ?? 0 })
                    : t('trash.history.sync', {
                        create: c?.create ?? 0,
                        update: c?.update ?? 0,
                        remove: c?.remove ?? 0,
                      })}
                  {e.error ? <div className="text-xs text-critical">{e.error}</div> : null}
                  {e.rolledBackAt ? (
                    <div className="text-xs text-muted">{t('trash.history.rolledBack')}</div>
                  ) : null}
                </td>
                <td className="px-4 py-2">
                  {e.actor === 'guard' ? t('trash.history.guard') : t('trash.history.admin')}
                </td>
                <td className="px-4 py-2">
                  <Badge tone={STATUS_TONE[e.status]}>{t(`trash.status.${e.status}`)}</Badge>
                </td>
                <td className="px-4 py-2 text-right">
                  {e.kind === 'sync' && e.hasBackup && !e.rolledBackAt ? (
                    <Button variant="ghost" onClick={() => setRollback(e)}>
                      {t('trash.history.undo')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {undo.isError ? <InlineError {...errorText(t, undo.error)} /> : null}
      <ConfirmDialog
        open={rollback !== null}
        onOpenChange={(o) => !o && setRollback(null)}
        title={t('trash.history.undoTitle', { instance: rollback?.instanceName ?? '' })}
        body={t('trash.history.undoBody')}
        confirmLabel={t('trash.history.undo')}
        busy={undo.isPending}
        danger
        onConfirm={() => rollback && undo.mutate(rollback.id)}
      />
    </Card>
  );
}

interface ReleaseResult {
  parsed: {
    title: string;
    quality: string | null;
    languages: string[];
    releaseGroup: string | null;
    customFormats: Array<{ id: number; name: string }>;
  };
  profiles: Array<{
    id: number;
    name: string;
    managed: boolean;
    total: number;
    accepted: boolean;
    meetsCutoff: boolean;
    formats: Array<{ id: number; name: string; score: number }>;
  }>;
}

function ReleaseTestTab({ data }: { data: TrashOverview }) {
  const { t } = useTranslation();
  const [instance, setInstance] = useState(data.instances[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const test = useMutation({
    mutationFn: () =>
      api<ReleaseResult>(`/api/trash/instances/${enc(instance)}/release-test`, {
        method: 'POST',
        body: { title },
      }),
  });
  const r = test.data;
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('trash.test.intro')}</p>
        <div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
          <Select
            label={t('trash.test.instance')}
            value={instance}
            onChange={setInstance}
            options={data.instances.map((i): [string, string] => [i.id, i.name])}
          />
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (instance && title.trim().length >= 3) test.mutate();
            }}
          >
            <TextField
              className="flex-1"
              label={t('trash.test.release')}
              placeholder="Example.Film.2021.1080p.BluRay.x264-GROUP"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Button
              type="submit"
              variant="primary"
              busy={test.isPending}
              disabled={!instance || title.trim().length < 3}
            >
              {t('trash.test.run')}
            </Button>
          </form>
        </div>
        {test.isError ? <InlineError {...errorText(t, test.error)} /> : null}
      </Card>
      {r ? (
        <>
          <Card className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span>
              <span className="text-muted">{t('trash.test.quality')}: </span>
              {r.parsed.quality ?? '—'}
            </span>
            <span>
              <span className="text-muted">{t('trash.test.group')}: </span>
              {r.parsed.releaseGroup ?? '—'}
            </span>
            <span>
              <span className="text-muted">{t('trash.test.languages')}: </span>
              {r.parsed.languages.join(', ') || '—'}
            </span>
            <span className="w-full">
              <span className="text-muted">{t('trash.test.formats')}: </span>
              {r.parsed.customFormats.map((f) => f.name).join(', ') || t('trash.test.noFormats')}
            </span>
          </Card>
          <ul className="grid gap-4 lg:grid-cols-2">
            {r.profiles.map((p) => (
              <Card as="li" key={p.id} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">
                    {p.name}
                    {p.managed ? (
                      <span className="ml-2 align-middle">
                        <Badge tone="info">{t('trash.test.managed')}</Badge>
                      </span>
                    ) : null}
                  </h3>
                  <span className="text-lg font-semibold tabular-nums">{p.total}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={p.accepted ? 'ok' : 'critical'}>
                    {p.accepted ? t('trash.test.accepted') : t('trash.test.rejected')}
                  </Badge>
                  {p.meetsCutoff ? <Badge tone="ok">{t('trash.test.cutoff')}</Badge> : null}
                </div>
                <ul className="text-sm">
                  {p.formats.map((f) => (
                    <li key={f.id} className="flex justify-between gap-3 border-t border-border py-1">
                      <span>{f.name}</span>
                      <span
                        className={`tabular-nums ${f.score < 0 ? 'text-critical' : f.score > 0 ? 'text-ok' : 'text-muted'}`}
                      >
                        {f.score}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function SettingsTab({ data }: { data: TrashOverview }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [s, setS] = useState<TrashSettings>(data.settings);
  const save = useMutation({
    mutationFn: () => api<{ settings: TrashSettings }>('/api/trash/settings', { method: 'PUT', body: s }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['trash'] }),
  });
  const local = data.guide.source === 'directory';
  const set = <K extends keyof TrashSettings>(k: K, v: TrashSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  return (
    <Card className="flex max-w-2xl flex-col gap-5">
      {local ? (
        <p className="text-sm text-muted">{t('trash.settings.local')}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('trash.settings.repo')}
            help={t('trash.settings.repoHelp')}
            value={s.repo}
            onChange={(e) => set('repo', e.target.value)}
          />
          <TextField
            label={t('trash.settings.branch')}
            value={s.branch}
            onChange={(e) => set('branch', e.target.value)}
          />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label={t('trash.settings.refreshHours')}
          unit={t('trash.settings.hours')}
          min={1}
          max={720}
          value={s.refreshHours}
          onChange={(v) => set('refreshHours', v)}
        />
        <NumberField
          label={t('trash.settings.guardHours')}
          unit={t('trash.settings.hours')}
          min={1}
          max={168}
          value={s.guardHours}
          onChange={(v) => set('guardHours', v)}
        />
        <NumberField
          label={t('trash.settings.maxAutoChanges')}
          help={t('trash.settings.maxAutoChangesHelp')}
          min={1}
          max={1000}
          value={s.maxAutoChanges}
          onChange={(v) => set('maxAutoChanges', v)}
        />
        <NumberField
          label={t('trash.settings.backups')}
          help={t('trash.settings.backupsHelp')}
          min={1}
          max={100}
          value={s.backupsPerInstance}
          onChange={(v) => set('backupsPerInstance', v)}
        />
      </div>
      <p className="text-xs text-muted">{t('trash.settings.license')}</p>
      {save.isError ? <InlineError {...errorText(t, save.error)} /> : null}
      <div className="flex items-center gap-3">
        <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
          {t('ui.common.save')}
        </Button>
        {save.isSuccess ? (
          <span className="text-sm text-ok" role="status">
            {t('ui.common.saved')}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

export function TrashPage() {
  const { t } = useTranslation();
  const search = useSearch({ from: '/trash' });
  const navigate = useNavigate({ from: '/trash' });
  const data = useTrash();
  const [editing, setEditing] = useState<EditorInput | null>(null);
  const tab: TrashTab = search.tab ?? 'instances';
  const setTab = (next: TrashTab) =>
    void navigate({ search: { tab: next === 'instances' ? undefined : next } });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">{t('trash.title')}</h1>
        <p className="text-sm text-muted">{t('trash.subtitle')}</p>
      </div>
      {data.isError ? (
        <InlineError message={t('ui.errors.loadFailed')} onRetry={() => void data.refetch()} />
      ) : null}
      {data.isPending ? <Skeleton className="h-64 rounded-[var(--radius-card)]" /> : null}
      {data.data ? (
        editing ? (
          <TemplateEditor
            key={editing.id ?? 'new'}
            input={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              setTab('templates');
            }}
          />
        ) : (
          <>
            <GuideHeader data={data.data} />
            <Tabs
              label={t('trash.title')}
              value={tab}
              onChange={setTab}
              options={[
                ['instances', t('trash.tabs.instances'), data.data.instances.length],
                ['templates', t('trash.tabs.templates'), data.data.templates.length],
                ['history', t('trash.tabs.history')],
                ['test', t('trash.tabs.test')],
                ['settings', t('trash.tabs.settings')],
              ]}
            />
            {tab === 'instances' ? (
              <InstancesTab data={data.data} focus={search.instance} onEditTemplate={setEditing} />
            ) : null}
            {tab === 'templates' ? <TemplatesTab data={data.data} onEdit={setEditing} /> : null}
            {tab === 'history' ? <HistoryTab data={data.data} /> : null}
            {tab === 'test' ? <ReleaseTestTab data={data.data} /> : null}
            {tab === 'settings' ? <SettingsTab data={data.data} /> : null}
          </>
        )
      ) : null}
    </div>
  );
}
