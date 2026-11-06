// Hunting: which titles Wardarr searches next and why, what earlier
// searches found, and the pace per instance.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { Msg } from '@wardarr/core';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Funnel, Gauge, SegmentBar, useCalm, useWidth, type ChartTone } from '../components/charts';
import { InstanceChips, PageHeader } from '../components/dash';
import {
  Badge,
  Button,
  Card,
  Choice,
  CountUp,
  Disclosure,
  EmptyState,
  InlineError,
  NumberField,
  SectionTitle,
  Skeleton,
  Toggle,
  spring,
  type Tone,
} from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatRelative } from '../lib/format';
import { tm } from '../lib/i18n';

type Pace = 'off' | 'gentle' | 'normal' | 'fast' | 'custom';
type List = 'missing' | 'cutoff';

interface Rate {
  count: number;
  everyMinutes: number;
}

interface HuntingConfig {
  pace: Pace;
  missing: Rate;
  cutoff: Rate;
  apiCallsPerHour: number;
  pauseQueueSize: number;
  researchAfterDays: number;
  monitoredOnly: boolean;
  preferSeasonPacks: boolean;
  includeTags: number[];
  excludeTags: number[];
  qualityProfileIds: number[];
  minYear: number | null;
  maxYear: number | null;
}

interface Candidate {
  key: string;
  title: string;
  list: List;
  reason: Msg;
  at: string | null;
}

interface HuntInstance {
  instanceId: string;
  instanceName: string;
  adapter: string;
  adapterName: string;
  config: HuntingConfig;
  pause: { kind: string; reason: Msg } | null;
  error: string | null;
  budget: { left: number; limit: number };
  lists: Record<
    List,
    { rate: Rate; lastRunAt: string | null; nextRunAt: string | null; upcoming: Candidate[]; waiting: number }
  >;
  stats: { searches: number; finished: number; found: number; imported: number; rate: number | null };
  searches: Array<{
    id: number;
    key: string;
    title: string;
    list: List;
    reason: Msg;
    at: string;
    manual: boolean;
    result: string;
  }>;
  exclusions: Array<{ key: string; title: string }>;
}

const RESULT_TONE: Record<string, Tone> = {
  pending: 'neutral',
  nothing: 'neutral',
  grabbed: 'info',
  imported: 'ok',
  failed: 'critical',
};

const PACES: Pace[] = ['off', 'gentle', 'normal', 'fast'];
const enc = encodeURIComponent;

export function HuntingPage() {
  const { t } = useTranslation();
  const search = useSearch({ from: '/hunting' });
  const navigate = useNavigate({ from: '/hunting' });
  const data = useQuery({
    queryKey: ['hunting'],
    queryFn: () => api<{ instances: HuntInstance[] }>('/api/hunting'),
    refetchInterval: 30_000,
  });
  const instances = data.data?.instances ?? [];
  const current = instances.find((i) => i.instanceId === search.instance) ?? instances[0];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('ui.hunting.eyebrow')}
        title={t('ui.hunting.title')}
        intro={t('ui.hunting.subtitle')}
      />
      {instances.length > 1 ? (
        <InstanceChips
          label={t('ui.hunting.instances')}
          items={instances.map((i) => ({
            id: i.instanceId,
            name: i.instanceName,
            adapter: i.adapter,
            tone: huntTone(i),
          }))}
          current={current?.instanceId}
          onPick={(id) => void navigate({ search: { instance: id } })}
        />
      ) : null}
      {data.isError ? (
        <InlineError message={t('ui.errors.loadFailed')} onRetry={() => void data.refetch()} />
      ) : null}
      {data.isPending ? <Skeleton className="h-64 rounded-[var(--radius-card)]" /> : null}
      {data.isSuccess && !current ? (
        <Card>
          <EmptyState title={t('ui.hunting.noInstances')} body={t('ui.hunting.noInstancesBody')} />
        </Card>
      ) : null}
      {current ? <InstanceView key={current.instanceId} inst={current} /> : null}
    </div>
  );
}

function useHuntingAction<T>(instanceId: string, path: string, method: 'POST' | 'PUT' = 'POST') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: T) => api(`/api/hunting/${enc(instanceId)}${path}`, { method, body }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['hunting'] }),
  });
}

function huntTone(i: HuntInstance): ChartTone {
  if (i.error) return 'critical';
  if (i.pause) return i.pause.kind === 'off' ? 'neutral' : 'warning';
  return 'ok';
}

function InstanceView({ inst }: { inst: HuntInstance }) {
  const { t } = useTranslation();
  const pace = useHuntingAction<{ pace: Pace }>(inst.instanceId, '/settings', 'PUT');
  const run = useHuntingAction<Record<string, never>>(inst.instanceId, '/run');
  const { left, limit } = inst.budget;
  const s = inst.stats;

  return (
    <>
      <Card className="flex flex-col gap-6">
        <div className="grid gap-8 lg:grid-cols-[auto_1.2fr_1fr] lg:items-center">
          <div className="flex justify-center">
            <Gauge
              value={left}
              max={limit}
              tone={left < limit / 5 ? 'warning' : 'accent'}
              label={t('ui.hunting.budget')}
            >
              <span className="flex flex-col items-center leading-tight">
                <span className="text-4xl font-bold tracking-tight tabular-nums">
                  <CountUp value={left} />
                </span>
                <span className="text-xs text-muted">{t('ui.hunting.callsLeft')}</span>
                <span className="text-xs text-muted">{t('ui.hunting.ofLimit', { count: limit })}</span>
              </span>
            </Gauge>
          </div>

          <div className="flex flex-col gap-4">
            <Choice
              label={t('ui.hunting.pace')}
              value={inst.config.pace === 'custom' ? 'custom' : inst.config.pace}
              options={[...PACES, ...(inst.config.pace === 'custom' ? (['custom'] as Pace[]) : [])].map(
                (p) => [p, t(`hunting.pace.${p}`)],
              )}
              onChange={(p) => p !== 'custom' && pace.mutate({ pace: p })}
            />
            <p className="text-sm text-muted">
              {t('ui.hunting.paceSummary', {
                missing: rateText(t, inst.config.missing),
                cutoff: rateText(t, inst.config.cutoff),
              })}
            </p>
            <div>
              <Button onClick={() => run.mutate({})} busy={run.isPending} disabled={!!inst.pause}>
                {t('ui.hunting.runNow')}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
              {t('ui.hunting.funnelTitle')}
            </span>
            <Funnel
              label={t('ui.hunting.successRate')}
              stages={[
                {
                  key: 'searched',
                  label: t('ui.hunting.funnel.searched'),
                  value: s.finished,
                  tone: 'accent',
                },
                { key: 'found', label: t('ui.hunting.funnel.found'), value: s.found, tone: 'info' },
                { key: 'imported', label: t('ui.hunting.funnel.imported'), value: s.imported, tone: 'ok' },
              ]}
            />
            <p className="text-sm">
              {s.rate === null
                ? t('ui.hunting.funnelNone')
                : t('ui.hunting.funnelRate', { percent: Math.round(s.rate * 100) })}
            </p>
          </div>
        </div>

        {inst.pause ? (
          <div
            role="status"
            className={`rounded-lg px-3 py-2 text-sm ${inst.pause.kind === 'off' ? 'bg-surface-2 text-muted' : 'bg-warning-bg text-warning'}`}
          >
            {tm(t, inst.pause.reason)}
          </div>
        ) : null}
        {inst.error ? (
          <InlineError
            message={t('ui.hunting.runFailed', {
              error: t(`ui.instance.testFailed.${inst.error}`, { defaultValue: inst.error }),
            })}
          />
        ) : null}

        <PlanStrip inst={inst} />
      </Card>

      <UpNext inst={inst} />
      <Results inst={inst} />
      <Exclusions inst={inst} />
      <Advanced inst={inst} />
    </>
  );
}

interface PlannedRun {
  at: number;
  list: List;
  count: number;
}

const DAY_MS = 86_400_000;

/** When the next searches happen over the next 24 hours, from each list's pace and next run. */
function plannedRuns(inst: HuntInstance, now: number): PlannedRun[] {
  if (inst.pause) return [];
  const out: PlannedRun[] = [];
  for (const list of ['missing', 'cutoff'] as List[]) {
    const { rate, nextRunAt } = inst.lists[list];
    if (rate.count <= 0 || rate.everyMinutes <= 0) continue;
    let at = nextRunAt ? Math.max(now, Date.parse(nextRunAt)) : now;
    for (let i = 0; at <= now + DAY_MS && i < 300; i++, at += rate.everyMinutes * 60_000) {
      out.push({ at, list, count: rate.count });
    }
  }
  return out;
}

function PlanStrip({ inst }: { inst: HuntInstance }) {
  const { t, i18n } = useTranslation();
  const calm = useCalm();
  const [now] = useState(() => Date.now());
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const runs = plannedRuns(inst, now);
  const total = runs.reduce((sum, r) => sum + r.count, 0);
  const pad = 10;
  const height = 64;
  const lane: Record<List, number> = { missing: 18, cutoff: 40 };
  const x = (at: number) => pad + ((at - now) / DAY_MS) * Math.max(0, width - pad * 2);
  const time = (at: number) =>
    new Date(at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const hovered = hover === null ? null : runs[hover];

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          {t('ui.hunting.plan')}
        </span>
        <span className="text-xs text-muted" aria-live="polite">
          {hovered
            ? t('ui.hunting.planTip', {
                time: time(hovered.at),
                count: hovered.count,
                list: t(`hunting.list.${hovered.list}`),
              })
            : inst.pause
              ? t('ui.hunting.planPaused')
              : t('ui.hunting.planTotal', { count: total })}
        </span>
      </div>
      <div
        ref={ref}
        className="relative w-full"
        style={{ height: height + 16 }}
        onPointerLeave={() => setHover(null)}
      >
        {width > 0 ? (
          <svg
            width={width}
            height={height + 16}
            role="img"
            aria-label={`${t('ui.hunting.planLabel')}: ${total}`}
          >
            {(['missing', 'cutoff'] as List[]).map((l) => (
              <line
                key={l}
                x1={pad}
                x2={width - pad}
                y1={lane[l]}
                y2={lane[l]}
                stroke="var(--surface-2)"
                strokeWidth={6}
                strokeLinecap="round"
              />
            ))}
            {[0, 6, 12, 18, 24].map((h) => {
              const tx = x(now + h * 3_600_000);
              return (
                <g key={h}>
                  <line x1={tx} x2={tx} y1={6} y2={height - 10} stroke="var(--border)" strokeWidth={1} />
                  <text
                    x={tx}
                    y={height + 10}
                    fontSize={10}
                    textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}
                    fill="var(--muted)"
                  >
                    {h === 0 ? t('ui.hunting.planNow') : time(now + h * 3_600_000)}
                  </text>
                </g>
              );
            })}
            {runs.map((r, i) => {
              const cx = x(r.at);
              const cy = lane[r.list];
              const radius = Math.min(7, 3 + r.count);
              const filled = r.list === 'missing';
              return (
                <g
                  key={`${r.list}-${r.at}`}
                  tabIndex={0}
                  role="img"
                  aria-label={t('ui.hunting.planTip', {
                    time: time(r.at),
                    count: r.count,
                    list: t(`hunting.list.${r.list}`),
                  })}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none"
                >
                  <circle cx={cx} cy={cy} r={11} fill="transparent" />
                  <motion.circle
                    cx={cx}
                    cy={cy}
                    r={hover === i ? radius + 2 : radius}
                    fill={filled ? 'var(--accent)' : 'var(--surface)'}
                    stroke="var(--accent)"
                    strokeWidth={2}
                    initial={calm ? false : { scale: 0 }}
                    animate={{ scale: 1 }}
                    style={{ transformBox: 'fill-box', originX: 0.5, originY: 0.5 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 22, delay: 0.2 + i * 0.02 }}
                  />
                </g>
              );
            })}
          </svg>
        ) : null}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-accent" aria-hidden />
          {t('hunting.list.missing')}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2 border-accent" aria-hidden />
          {t('hunting.list.cutoff')}
        </li>
      </ul>
    </div>
  );
}

function rateText(t: (k: string, p?: Record<string, unknown>) => string, r: Rate): string {
  if (r.count <= 0) return t('hunting.pace.off');
  if (r.everyMinutes === 60) return t('ui.hunting.perHour', { count: r.count });
  if (r.everyMinutes % 60 === 0)
    return t('ui.hunting.everyHours', { count: r.count, hours: r.everyMinutes / 60 });
  return t('ui.hunting.everyMinutes', { count: r.count, minutes: r.everyMinutes });
}

function UpNext({ inst }: { inst: HuntInstance }) {
  const { t, i18n } = useTranslation();
  const searchNow = useHuntingAction<{ key: string }>(inst.instanceId, '/search');
  const exclude = useHuntingAction<{ key: string; title: string }>(inst.instanceId, '/exclude');
  const items = [...inst.lists.missing.upcoming, ...inst.lists.cutoff.upcoming].sort((a, b) =>
    (a.at ?? '').localeCompare(b.at ?? ''),
  );
  return (
    <Card>
      <SectionTitle>{t('ui.hunting.upNext')}</SectionTitle>
      {items.length === 0 ? (
        <EmptyState title={t('ui.hunting.upNextEmpty')} body={t('ui.hunting.upNextEmptyBody')} />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((c) => (
            <motion.li
              layout
              transition={spring}
              key={c.key}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5"
            >
              <Badge tone={c.list === 'missing' ? 'info' : 'neutral'}>{t(`hunting.list.${c.list}`)}</Badge>
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={c.title}>
                {c.title}
              </span>
              <span className="text-xs text-muted">
                {c.at ? formatRelative(c.at, i18n.language) : t('ui.hunting.whenPaused')}
              </span>
              <span className="basis-full text-xs text-muted">{tm(t, c.reason)}</span>
              <div className="flex gap-2">
                <Button
                  busy={searchNow.isPending && searchNow.variables?.key === c.key}
                  onClick={() => searchNow.mutate({ key: c.key })}
                >
                  {t('ui.hunting.searchNow')}
                </Button>
                <Button variant="ghost" onClick={() => exclude.mutate({ key: c.key, title: c.title })}>
                  {t('ui.hunting.exclude')}
                </Button>
              </div>
            </motion.li>
          ))}
        </ul>
      )}
      {searchNow.isError ? <InlineError {...errorText(t, searchNow.error)} /> : null}
    </Card>
  );
}

function Results({ inst }: { inst: HuntInstance }) {
  const { t, i18n } = useTranslation();
  return (
    <Card>
      <SectionTitle>{t('ui.hunting.results')}</SectionTitle>
      {inst.searches.length === 0 ? <EmptyState title={t('ui.hunting.resultsEmpty')} /> : null}
      {new Set(inst.searches.map((x) => x.result)).size > 1 ? (
        <div className="mb-2">
          <SegmentBar
            tall
            label={t('ui.hunting.outcomes')}
            segments={Object.keys(RESULT_TONE)
              .map((r) => ({
                key: r,
                label: t(`hunting.result.${r}`),
                value: inst.searches.filter((x) => x.result === r).length,
                tone: RESULT_TONE[r] ?? 'neutral',
              }))
              .filter((x) => x.value > 0)}
          />
        </div>
      ) : null}
      <ul className="flex flex-col divide-y divide-border">
        {inst.searches.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
            <Badge tone={RESULT_TONE[s.result] ?? 'neutral'}>{t(`hunting.result.${s.result}`)}</Badge>
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={s.title}>
              {s.title}
            </span>
            <time className="text-xs text-muted" dateTime={s.at}>
              {formatRelative(s.at, i18n.language)}
            </time>
            <span className="basis-full text-xs text-muted">{tm(t, s.reason)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Exclusions({ inst }: { inst: HuntInstance }) {
  const { t } = useTranslation();
  const include = useHuntingAction<{ key: string }>(inst.instanceId, '/include');
  if (inst.exclusions.length === 0) return null;
  return (
    <Card>
      <SectionTitle>{t('ui.hunting.excluded')}</SectionTitle>
      <ul className="flex flex-col divide-y divide-border">
        {inst.exclusions.map((e) => (
          <li key={e.key} className="flex items-center gap-3 py-2.5">
            <span className="min-w-0 flex-1 truncate text-sm" title={e.title}>
              {e.title}
            </span>
            <Button variant="ghost" onClick={() => include.mutate({ key: e.key })}>
              {t('ui.hunting.include')}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function IdPicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ id: number; name: string }>;
  value: number[];
  onChange: (v: number[]) => void;
}) {
  if (options.length === 0) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((v) => v !== o.id) : [...value, o.id])}
              className={`rounded-full border px-3 py-1 text-sm ${on ? 'border-accent bg-surface-2' : 'border-border'}`}
            >
              {o.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Advanced({ inst }: { inst: HuntInstance }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(inst.config);
  const set = <K extends keyof HuntingConfig>(k: K, v: HuntingConfig[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const save = useHuntingAction<Partial<HuntingConfig>>(inst.instanceId, '/settings', 'PUT');
  const filters = useQuery({
    queryKey: ['hunting-filters', inst.instanceId],
    queryFn: () =>
      api<{
        tags: Array<{ id: number; label: string }>;
        qualityProfiles: Array<{ id: number; name: string }>;
      }>(`/api/hunting/${enc(inst.instanceId)}/filters`),
    staleTime: 5 * 60_000,
  });
  const tags = (filters.data?.tags ?? []).map((x) => ({ id: x.id, name: x.label }));
  const m = t('ui.units.minutes');
  const ratesChanged =
    JSON.stringify([form.missing, form.cutoff]) !== JSON.stringify([inst.config.missing, inst.config.cutoff]);

  return (
    <Disclosure title={t('ui.common.advanced')}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          const { pace: _pace, ...rest } = form;
          save.mutate(ratesChanged ? rest : { ...rest, missing: undefined, cutoff: undefined });
        }}
      >
        {(['missing', 'cutoff'] as List[]).map((l) => (
          <div key={l} className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label={t('ui.hunting.s.count', { list: t(`hunting.list.${l}`) })}
              min={0}
              max={50}
              value={form[l].count}
              onChange={(v) => set(l, { ...form[l], count: v })}
            />
            <NumberField
              label={t('ui.hunting.s.every')}
              min={5}
              unit={m}
              value={form[l].everyMinutes}
              onChange={(v) => set(l, { ...form[l], everyMinutes: v })}
            />
          </div>
        ))}
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField
            label={t('ui.hunting.s.apiCalls')}
            help={t('ui.hunting.s.apiCallsHelp')}
            min={5}
            value={form.apiCallsPerHour}
            onChange={(v) => set('apiCallsPerHour', v)}
          />
          <NumberField
            label={t('ui.hunting.s.pauseQueue')}
            help={t('ui.hunting.s.pauseQueueHelp')}
            min={1}
            value={form.pauseQueueSize}
            onChange={(v) => set('pauseQueueSize', v)}
          />
          <NumberField
            label={t('ui.hunting.s.researchAfter')}
            unit={t('ui.units.days')}
            min={1}
            value={form.researchAfterDays}
            onChange={(v) => set('researchAfterDays', v)}
          />
        </div>
        <Toggle
          label={t('ui.hunting.s.monitoredOnly')}
          checked={form.monitoredOnly}
          onChange={(v) => set('monitoredOnly', v)}
        />
        <Toggle
          label={t('ui.hunting.s.seasonPacks')}
          help={t('ui.hunting.s.seasonPacksHelp')}
          checked={form.preferSeasonPacks}
          onChange={(v) => set('preferSeasonPacks', v)}
        />
        <IdPicker
          label={t('ui.hunting.s.includeTags')}
          options={tags}
          value={form.includeTags}
          onChange={(v) => set('includeTags', v)}
        />
        <IdPicker
          label={t('ui.hunting.s.excludeTags')}
          options={tags}
          value={form.excludeTags}
          onChange={(v) => set('excludeTags', v)}
        />
        <IdPicker
          label={t('ui.hunting.s.profiles')}
          options={filters.data?.qualityProfiles ?? []}
          value={form.qualityProfileIds}
          onChange={(v) => set('qualityProfileIds', v)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label={t('ui.hunting.s.minYear')}
            min={1800}
            value={form.minYear ?? NaN}
            onChange={(v) => set('minYear', Number.isFinite(v) ? v : null)}
          />
          <NumberField
            label={t('ui.hunting.s.maxYear')}
            min={1800}
            value={form.maxYear ?? NaN}
            onChange={(v) => set('maxYear', Number.isFinite(v) ? v : null)}
          />
        </div>
        {save.isError ? <InlineError {...errorText(t, save.error)} /> : null}
        <div className="flex items-center justify-end gap-3">
          {save.isSuccess ? (
            <span className="text-sm text-ok" role="status">
              {t('ui.common.saved')}
            </span>
          ) : null}
          <Button type="submit" variant="primary" busy={save.isPending}>
            {t('ui.common.save')}
          </Button>
        </div>
      </form>
    </Disclosure>
  );
}
