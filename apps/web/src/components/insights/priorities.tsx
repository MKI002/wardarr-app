// The priority watchdog: once a day it turns indexer scores into priorities
// in Prowlarr, and where Prowlarr does not pass them on, in the apps.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import { formatRelative } from '../../lib/format';
import {
  PRIORITY_MAX,
  PRIORITY_MIN,
  type PriorityItem,
  type SyncLevel,
  type WatchdogConfig,
  type WatchdogLogEntry,
  type WatchdogView,
} from '../../lib/insights';
import { tint, toneColor, useCalm } from '../charts';
import { ServiceLogo } from '../ServiceLogo';
import {
  Badge,
  Button,
  Card,
  Choice,
  Disclosure,
  InlineError,
  NumberField,
  Skeleton,
  Toggle,
  spring,
} from '../ui';

const KEY = ['indexerInsights', 'priorities'] as const;
const URL = '/api/indexer-insights/priorities';

/** Entries the watchdog writes itself, as opposed to ones it only explains. */
const WRITTEN = new Set(['change', 'same', 'close']);

export function PrioritySection() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const view = useQuery({ queryKey: KEY, queryFn: () => api<WatchdogView>(URL) });
  const save = useMutation({
    mutationFn: (patch: Partial<WatchdogConfig>) => api<WatchdogView>(URL, { method: 'PUT', body: patch }),
    onSuccess: (fresh) => client.setQueryData(KEY, fresh),
  });
  const run = useMutation({
    mutationFn: () => api<{ view: WatchdogView }>(`${URL}/run`, { method: 'POST' }),
    onSuccess: (res) => {
      client.setQueryData(KEY, res.view);
      void client.invalidateQueries({ queryKey: ['indexerInsights'], exact: false });
    },
  });

  if (view.isPending) return <Skeleton className="h-80 rounded-[var(--radius-card)]" />;
  if (view.isError) return <InlineError {...errorText(t, view.error)} onRetry={() => void view.refetch()} />;
  const v = view.data;
  if (!v.available) return null;

  return (
    <div className="flex flex-col gap-4">
      {save.isError ? <InlineError {...errorText(t, save.error)} /> : null}
      {run.isError ? <InlineError {...errorText(t, run.error)} /> : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Ladder
          view={v}
          busy={run.isPending}
          saving={save.isPending}
          onRun={() => run.mutate()}
          onSave={(patch) => save.mutate(patch)}
        />
        <WhereToSet view={v} saving={save.isPending} onSave={(patch) => save.mutate(patch)} />
      </div>
      <ChangeLog log={v.log} />
    </div>
  );
}

// ------------------------------------------------------------------ ladder

function headline(v: WatchdogView, t: (k: string, o?: Record<string, unknown>) => string, lang: string) {
  const changes = v.items.filter((i) => i.reason === 'change').length;
  if (!v.config.enabled) return t('insights.priorities.state.off', { count: changes });
  if (changes === 0) return t('insights.priorities.state.settled');
  const when = formatRelative(v.nextRunAt, lang);
  return v.config.mode === 'apply'
    ? t('insights.priorities.state.apply', { count: changes, when })
    : t('insights.priorities.state.preview', { count: changes, when });
}

function Ladder({
  view: v,
  busy,
  saving,
  onRun,
  onSave,
}: {
  view: WatchdogView;
  busy: boolean;
  saving: boolean;
  onRun: () => void;
  onSave: (patch: Partial<WatchdogConfig>) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const shown = v.items.filter((i) => WRITTEN.has(i.reason));
  const groups = [...new Set(shown.map((i) => i.instanceId))].map((id) => {
    const items = shown
      .filter((i) => i.instanceId === id)
      .sort(
        (a, b) =>
          (a.planned ?? PRIORITY_MAX) - (b.planned ?? PRIORITY_MAX) ||
          a.indexerName.localeCompare(b.indexerName),
      );
    return { id, name: items[0]!.instanceName, target: items[0]!.target, items };
  });
  groups.sort((a, b) =>
    a.target === b.target ? a.name.localeCompare(b.name) : a.target === 'prowlarr' ? -1 : 1,
  );
  const unscored = v.items.filter((i) => i.target === 'prowlarr' && i.reason === 'noScore');
  const disabled = v.items.filter((i) => i.target === 'prowlarr' && i.reason === 'disabled');

  return (
    <motion.div
      className="lg:col-span-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <Card as="div" className="flex h-full flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="font-semibold">{t('insights.priorities.title')}</h3>
            <p className="text-sm text-balance">{headline(v, t, lang)}</p>
            {v.lastRun ? (
              <p className="text-xs text-muted">
                {t(`insights.priorities.lastRun.${v.lastRun.mode}`, {
                  when: formatRelative(v.lastRun.at, lang),
                  count: v.lastRun.changed,
                })}
                {v.lastRun.failed > 0
                  ? ` ${t('insights.priorities.lastRun.failed', { count: v.lastRun.failed })}`
                  : ''}
              </p>
            ) : null}
          </div>
          <Button busy={busy} onClick={onRun}>
            {v.config.mode === 'apply'
              ? t('insights.priorities.runApply')
              : t('insights.priorities.runPreview')}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Toggle
            label={t('insights.priorities.enabled')}
            help={t('insights.priorities.enabledHelp')}
            checked={v.config.enabled}
            disabled={saving}
            onChange={(enabled) => onSave({ enabled })}
          />
          <Choice
            label={t('insights.priorities.mode.label')}
            value={v.config.mode}
            options={[
              ['preview', t('insights.priorities.mode.preview')],
              ['apply', t('insights.priorities.mode.apply')],
            ]}
            onChange={(mode) => onSave({ mode })}
          />
        </div>

        {groups.length === 0 ? (
          <p className="text-sm text-muted">{t('insights.priorities.noScores')}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <Scale config={v.config} />
            {groups.map((g) => (
              <div key={g.id} className="flex flex-col gap-2">
                {groups.length > 1 ? (
                  <span className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
                    {g.name}
                  </span>
                ) : null}
                <ul className="flex flex-col gap-1.5">
                  {g.items.map((item, idx) => (
                    <LadderRow
                      key={`${item.target}:${item.instanceId}:${item.indexerId}`}
                      item={item}
                      config={v.config}
                      index={idx}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {groups.length > 0 ? (
          <p className="text-xs text-muted">
            {t('insights.priorities.scaleNote', { best: v.config.best, worst: v.config.worst })}
          </p>
        ) : null}

        {unscored.length + disabled.length > 0 ? (
          <p className="text-xs text-muted">
            {[
              unscored.length
                ? t('insights.priorities.unscored', { list: unscored.map((i) => i.indexerName).join(', ') })
                : null,
              disabled.length
                ? t('insights.priorities.disabled', { list: disabled.map((i) => i.indexerName).join(', ') })
                : null,
            ]
              .filter(Boolean)
              .join(' ')}
          </p>
        ) : null}

        <Disclosure title={t('insights.priorities.tuning.title')}>
          <Tuning
            key={`${v.config.best}:${v.config.worst}:${v.config.step}`}
            config={v.config}
            saving={saving}
            onSave={onSave}
          />
        </Disclosure>
      </Card>
    </motion.div>
  );
}

const pos = (p: number) => `${((p - PRIORITY_MIN) / (PRIORITY_MAX - PRIORITY_MIN)) * 100}%`;

/** The 1 to 50 axis with the band the watchdog uses. */
function Scale({ config }: { config: WatchdogConfig }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr_4.5rem] items-end gap-3 text-xs text-muted sm:grid-cols-[minmax(0,11rem)_1fr_5rem]">
      <span>{t('insights.priorities.indexer')}</span>
      <div className="relative h-4 tabular-nums" aria-hidden>
        <span className="absolute left-0">{PRIORITY_MIN}</span>
        {/* The band ends; too close to the axis ends on a phone. */}
        <span className="absolute hidden -translate-x-1/2 sm:inline" style={{ left: pos(config.best) }}>
          {config.best}
        </span>
        <span className="absolute hidden -translate-x-1/2 sm:inline" style={{ left: pos(config.worst) }}>
          {config.worst}
        </span>
        <span className="absolute right-0">{PRIORITY_MAX}</span>
      </div>
      <span className="text-right">{t('insights.priorities.priority')}</span>
    </div>
  );
}

function LadderRow({ item, config, index }: { item: PriorityItem; config: WatchdogConfig; index: number }) {
  const { t, i18n } = useTranslation();
  const calm = useCalm();
  const accent = toneColor('accent');
  const from = item.current ?? item.planned ?? PRIORITY_MAX;
  const to = item.planned ?? from;
  const moving = item.reason === 'change' && from !== to;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const score =
    item.score === null
      ? '–'
      : new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 }).format(item.score);
  const label = moving
    ? t('insights.priorities.rowChange', { name: item.indexerName, from, to, score })
    : t('insights.priorities.rowKeep', { name: item.indexerName, value: to, score });
  return (
    <motion.li
      className="grid grid-cols-[minmax(0,9rem)_1fr_4.5rem] items-center gap-3 sm:grid-cols-[minmax(0,11rem)_1fr_5rem]"
      initial={calm ? false : { opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...spring, delay: calm ? 0 : 0.03 * index }}
      aria-label={label}
      title={item.reason === 'close' ? t('insights.priorities.reason.close') : undefined}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm font-medium">{item.indexerName}</span>
        <span className="shrink-0 text-xs text-muted tabular-nums">{score}</span>
      </span>
      <div className="relative h-6" aria-hidden>
        {/* The band from best to worst. */}
        <span
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full"
          style={{
            left: pos(config.best),
            width: `calc(${pos(config.worst)} - ${pos(config.best)})`,
            background: tint('accent', 12),
          }}
        />
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        {moving ? (
          <motion.span
            className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full"
            style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})`, background: tint('accent', 55) }}
            initial={calm ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ ...spring, delay: calm ? 0 : 0.1 + 0.03 * index }}
          />
        ) : null}
        {moving ? (
          // Where it is now.
          <span
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-surface"
            style={{ left: pos(from), borderColor: toneColor('neutral') }}
          />
        ) : null}
        <motion.span
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--surface)]"
          style={{ background: accent }}
          initial={calm ? false : { left: pos(from) }}
          animate={{ left: pos(to) }}
          transition={{ ...spring, delay: calm ? 0 : 0.1 + 0.03 * index }}
        />
      </div>
      <span className="text-right text-sm tabular-nums">
        {moving ? (
          <>
            <span className="text-muted">{from} → </span>
            <span className="font-semibold">{to}</span>
          </>
        ) : (
          <span>{to}</span>
        )}
      </span>
    </motion.li>
  );
}

function Tuning({
  config,
  saving,
  onSave,
}: {
  config: WatchdogConfig;
  saving: boolean;
  onSave: (patch: Partial<WatchdogConfig>) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState({ best: config.best, worst: config.worst, step: config.step });
  const inRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
  const valid =
    inRange(draft.best, PRIORITY_MIN, PRIORITY_MAX) &&
    inRange(draft.worst, PRIORITY_MIN, PRIORITY_MAX) &&
    inRange(draft.step, 1, 10) &&
    draft.best < draft.worst;
  const dirty = draft.best !== config.best || draft.worst !== config.worst || draft.step !== config.step;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t('insights.priorities.tuning.body')}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <NumberField
          label={t('insights.priorities.tuning.best')}
          value={draft.best}
          min={PRIORITY_MIN}
          max={PRIORITY_MAX}
          onChange={(best) => setDraft({ ...draft, best })}
        />
        <NumberField
          label={t('insights.priorities.tuning.worst')}
          value={draft.worst}
          min={PRIORITY_MIN}
          max={PRIORITY_MAX}
          onChange={(worst) => setDraft({ ...draft, worst })}
        />
        <NumberField
          label={t('insights.priorities.tuning.step')}
          help={t('insights.priorities.tuning.stepHelp')}
          value={draft.step}
          min={1}
          max={10}
          onChange={(step) => setDraft({ ...draft, step })}
        />
      </div>
      {!valid ? <p className="text-xs text-critical">{t('insights.priorities.tuning.invalid')}</p> : null}
      <div>
        <Button variant="primary" disabled={!dirty || !valid} busy={saving} onClick={() => onSave(draft)}>
          {t('insights.priorities.tuning.save')}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------- where to set it

const SYNC_TONE: Record<SyncLevel | 'none', 'neutral' | 'info' | 'warning'> = {
  fullSync: 'neutral',
  addOnly: 'info',
  disabled: 'warning',
  none: 'neutral',
};

function WhereToSet({
  view: v,
  saving,
  onSave,
}: {
  view: WatchdogView;
  saving: boolean;
  onSave: (patch: Partial<WatchdogConfig>) => void;
}) {
  const { t } = useTranslation();
  return (
    <motion.div
      className="lg:col-span-2"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 0.05 }}
    >
      <Card as="div" className="flex h-full flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold">{t('insights.priorities.apps.title')}</h3>
          <p className="text-sm text-muted">{t('insights.priorities.apps.intro')}</p>
        </div>
        {v.apps.length === 0 ? (
          <p className="text-sm text-muted">{t('insights.priorities.apps.none')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {v.apps.map((app) => {
              const entries = v.items.filter((i) => i.target === 'app' && i.instanceId === app.instanceId);
              const synced = entries.filter((i) => i.reason === 'prowlarrSyncs').length;
              const own = entries.length - synced;
              const level = app.syncLevel ?? 'none';
              return (
                <li key={app.instanceId} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <ServiceLogo adapter={app.adapter} name={app.instanceName} size={20} />
                    <span className="min-w-0 truncate font-medium">{app.instanceName}</span>
                    <span className="ml-auto shrink-0">
                      <Badge tone={SYNC_TONE[level]}>{t(`insights.priorities.sync.${level}`)}</Badge>
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    {t(`insights.priorities.sync.${level}Body`, { prowlarr: app.prowlarrName ?? 'Prowlarr' })}
                  </p>
                  {entries.length > 0 ? (
                    <p className="text-xs">
                      {[
                        synced ? t('insights.priorities.apps.followProwlarr', { count: synced }) : null,
                        own
                          ? v.config.includeApps
                            ? t('insights.priorities.apps.setHere', { count: own })
                            : t('insights.priorities.apps.untouched', { count: own })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-auto border-t border-border pt-4">
          <Toggle
            label={t('insights.priorities.includeApps')}
            help={t('insights.priorities.includeAppsHelp')}
            checked={v.config.includeApps}
            disabled={saving}
            onChange={(includeApps) => onSave({ includeApps })}
          />
        </div>
      </Card>
    </motion.div>
  );
}

// -------------------------------------------------------------------- log

function ChangeLog({ log }: { log: WatchdogLogEntry[] }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const runs = [...new Set(log.map((l) => l.at))].slice(0, 5).map((at) => ({
    at,
    entries: log.filter((l) => l.at === at),
  }));
  return (
    <Card className="flex flex-col gap-3">
      <h3 className="font-semibold">{t('insights.priorities.log.title')}</h3>
      {runs.length === 0 ? (
        <p className="text-sm text-muted">{t('insights.priorities.log.empty')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {runs.map((run) => (
            <div key={run.at} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <time dateTime={run.at}>
                  {new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(
                    new Date(run.at),
                  )}
                </time>
                <span>· {formatRelative(run.at, lang)}</span>
                {run.entries[0]!.preview ? (
                  <Badge tone="neutral">{t('insights.priorities.log.preview')}</Badge>
                ) : null}
              </div>
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {run.entries.map((e) => (
                  <li
                    key={`${e.target}:${e.instanceId}:${e.indexerId}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{e.indexerName}</span>
                    <span className="text-xs text-muted">
                      {e.target === 'prowlarr'
                        ? (e.instanceName ?? 'Prowlarr')
                        : t('insights.priorities.log.inApp', { app: e.instanceName ?? '?' })}
                    </span>
                    <span className="tabular-nums">
                      <span className="text-muted">{e.from ?? '–'} → </span>
                      <span className="font-semibold">{e.to}</span>
                    </span>
                    {e.error ? (
                      <Badge tone="critical">
                        {t('insights.priorities.log.failed', {
                          reason: t(`insights.priorities.log.error.${e.error}`, {
                            defaultValue: t('insights.priorities.log.error.badResponse'),
                          }),
                        })}
                      </Badge>
                    ) : e.preview ? null : (
                      <Badge tone="ok">{t('insights.priorities.log.done')}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
