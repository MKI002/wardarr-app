// Gatekeeper ("Torwache"): which file types never get through, where they are
// blocked, and what got caught. The hero answers "is anything slipping
// through, and from where?"; the analysis map shows which indexer sent what.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  EXTENSION_PRESETS,
  OTHER_KEY,
  UNKNOWN_KEY,
  parseExtensionList,
  uniqueExtensions,
  type ExtensionBlockStatus,
  type ExtensionPreset,
} from '@wardarr/core';
import { motion } from 'motion/react';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { tint, toneColor, useCalm, useWidth, type ChartTone } from '../components/charts';
import { MiniBars, Odometer, PageHeader, SectionRule } from '../components/dash';
import { ServiceLogo } from '../components/ServiceLogo';
import {
  Badge,
  Button,
  Card,
  Choice,
  EmptyState,
  Guardian,
  InlineError,
  SectionTitle,
  Skeleton,
  StatusDot,
  TextField,
  Toggle,
  spring,
  useSvgId,
  type Tone,
} from '../components/ui';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatRelative } from '../lib/format';

type Range = '7d' | '30d' | '90d';
const RANGES: Range[] = ['7d', '30d', '90d'];
const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 };

type Sync = 'inSync' | 'drift' | 'partial' | 'off' | 'error' | 'blocked' | 'own';

interface Config {
  extensions: string[];
  targets: Record<string, boolean>;
  sabAction: 'abort' | 'pause';
  autoRepair: boolean;
}

interface Target {
  instanceId: string;
  name: string;
  adapter: string;
  level: 'downloader' | 'arr';
  recommended: boolean;
  enabled: boolean;
  status: ExtensionBlockStatus | null;
  error: string | null;
  sync: Sync;
  missing: string[];
  unreachable: string[];
  lastApplied: { at: string; error: string | null } | null;
}

interface Catch {
  downloadId: string;
  name: string;
  at: string;
  extensions: string[];
  outcome: 'aborted' | 'paused' | 'skipped' | 'failed' | 'held';
  reason: string;
  seenBy: Array<{ instanceId: string; name: string; adapter: string }>;
  indexer: { key: string | null; name: string } | null;
}

interface FlowIndexer {
  key: string;
  name: string;
  caught: number;
  grabs: number;
  rate: number | null;
}

interface Flow {
  indexers: FlowIndexer[];
  extensions: Array<{ ext: string; count: number }>;
  links: Array<{ from: string; to: string; count: number }>;
  total: number;
}

interface Impact {
  key: string;
  name: string;
  grabs: number;
  caught: number;
  rate: number | null;
  scoreWith: number | null;
  scoreWithout: number | null;
}

interface RedownloadCheck {
  instanceId: string;
  name: string;
  adapter: string;
  redownload: boolean | null;
  completedHandling: boolean | null;
  error: string | null;
}

interface GatekeeperData {
  configured: boolean;
  config: Config;
  targets: Target[];
  range: Range;
  totals: { caught: number; previous: number; grabs: number; indexers: number };
  daily: Array<{ day: string; count: number }>;
  flow: Flow;
  impact: Impact[];
  recent: Catch[];
  redownload: RedownloadCheck[];
  lastRun: string | null;
}

const TIME_ZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

const SYNC_TONE: Record<Sync, Tone> = {
  inSync: 'ok',
  partial: 'info',
  drift: 'warning',
  off: 'neutral',
  error: 'critical',
  blocked: 'warning',
  own: 'info',
};

const sameConfig = (a: Config, b: Config) => JSON.stringify(a) === JSON.stringify(b);

function usePercent() {
  const { i18n } = useTranslation();
  return (v: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'percent',
      maximumFractionDigits: v > 0 && v < 0.1 ? 1 : 0,
    }).format(v);
}

export function GatekeeperPage() {
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>('30d');
  const query = useQuery({
    queryKey: ['gatekeeper', range],
    queryFn: () => api<GatekeeperData>(`/api/gatekeeper?range=${range}&tz=${encodeURIComponent(TIME_ZONE)}`),
    refetchInterval: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
  const client = useQueryClient();
  const check = useMutation({
    mutationFn: () => api('/api/gatekeeper/collect', { method: 'POST' }),
    onSettled: () => client.invalidateQueries({ queryKey: ['gatekeeper'] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('gatekeeper.eyebrow')}
        title={t('gatekeeper.title')}
        intro={t('gatekeeper.intro')}
        actions={
          <>
            <Choice
              label={t('gatekeeper.range')}
              hideLabel
              value={range}
              onChange={setRange}
              options={RANGES.map((r) => [r, t('gatekeeper.days', { count: RANGE_DAYS[r] })])}
            />
            {query.data?.configured ? (
              <Button onClick={() => check.mutate()} busy={check.isPending}>
                {t('gatekeeper.check')}
              </Button>
            ) : null}
          </>
        }
      />
      {query.isError ? (
        <InlineError {...errorText(t, query.error)} onRetry={() => void query.refetch()} />
      ) : null}
      {check.isError ? <InlineError {...errorText(t, check.error)} /> : null}
      {query.data ? (
        <GatekeeperBody data={query.data} />
      ) : query.isError ? null : (
        <div className="flex flex-col gap-4" aria-busy>
          <div className="grid gap-4 lg:grid-cols-5">
            <Skeleton className="h-80 rounded-[var(--radius-card)] lg:col-span-2" />
            <Skeleton className="h-80 rounded-[var(--radius-card)] lg:col-span-3" />
          </div>
          <Skeleton className="h-56 rounded-[var(--radius-card)]" />
        </div>
      )}
    </div>
  );
}

function GatekeeperBody({ data }: { data: GatekeeperData }) {
  const { t } = useTranslation();
  const days = RANGE_DAYS[data.range];
  return (
    <>
      {data.configured ? (
        <div className="grid gap-4 lg:grid-cols-5">
          <Hero data={data} days={days} />
          <Card className="lg:col-span-3">
            <SectionTitle>{t('gatekeeper.map.title')}</SectionTitle>
            <FlowMap flow={data.flow} />
          </Card>
        </div>
      ) : (
        <SetupCard />
      )}

      {data.configured ? (
        <>
          <SectionRule>{t('gatekeeper.impact.title')}</SectionRule>
          <ImpactCard impact={data.impact} configured={data.configured} />
        </>
      ) : null}

      <Settings data={data} />

      {data.configured ? (
        <>
          <SectionRule>{t('gatekeeper.recent.title')}</SectionRule>
          <RecentList recent={data.recent} />
        </>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- hero

function Hero({ data, days }: { data: GatekeeperData; days: number }) {
  const { t, i18n } = useTranslation();
  const { caught, previous, indexers } = data.totals;
  const enabled = data.targets.filter((x) => x.enabled);
  const active = enabled.filter((x) => x.sync === 'inSync' || x.sync === 'partial').length;
  const troubled = enabled.some((x) => x.sync !== 'inSync' && x.sync !== 'partial');
  const tone: Tone = active === 0 ? 'warning' : troubled ? 'warning' : 'ok';
  const protectedText = active
    ? t('gatekeeper.hero.protected', { active, total: data.targets.length })
    : t('gatekeeper.hero.unprotected');
  return (
    <Card className="flex flex-col gap-5 lg:col-span-2">
      <div className="flex flex-col gap-2">
        <span className="text-sm text-muted">{t('gatekeeper.hero.label')}</span>
        <Odometer text={new Intl.NumberFormat(i18n.language).format(caught)} className="text-6xl font-bold" />
        <p className="text-sm">
          {caught
            ? `${t('gatekeeper.hero.caught', { count: caught, days })} ${indexers ? t('gatekeeper.hero.indexers', { count: indexers }) : ''}`
            : t('gatekeeper.hero.none', { days })}
        </p>
        <p className="text-xs text-muted">{t('gatekeeper.hero.previous', { count: previous, days })}</p>
      </div>
      <MiniBars values={data.daily.map((d) => d.count)} label={t('gatekeeper.hero.daily')} height={52} />
      <div className="mt-auto flex flex-col gap-1.5 rounded-lg bg-surface-2 px-3 py-2.5 text-sm">
        <span className="flex items-center gap-2">
          <StatusDot tone={tone} label={protectedText} />
          <span aria-hidden>{protectedText}</span>
        </span>
        {data.lastRun ? (
          <span className="text-xs text-muted">
            {t('gatekeeper.hero.lastRun', { when: formatRelative(data.lastRun, i18n.language) })}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

function SetupCard() {
  const { t } = useTranslation();
  return (
    <Card className="flex flex-col gap-5 sm:flex-row sm:items-center">
      <motion.div
        className="shrink-0 self-center"
        initial={{ y: 6, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={spring}
      >
        <Guardian size={72} glance />
      </motion.div>
      <div className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{t('gatekeeper.setup.title')}</h2>
        <p className="max-w-prose text-sm text-muted">{t('gatekeeper.setup.body')}</p>
        <ol className="flex flex-col gap-2 text-sm">
          {(['step1', 'step2', 'step3'] as const).map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold tabular-nums">
                {i + 1}
              </span>
              <span>{t(`gatekeeper.setup.${s}`)}</span>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------- analysis map

type Focus = { kind: 'ix' | 'ext'; key: string } | { kind: 'link'; from: string; to: string } | null;

function useLabels() {
  const { t } = useTranslation();
  return {
    ix: (i: { key: string; name: string }) =>
      i.key === UNKNOWN_KEY
        ? t('gatekeeper.map.unknownIndexer')
        : i.key === OTHER_KEY
          ? t('gatekeeper.map.other')
          : i.name,
    ext: (e: string) =>
      e === UNKNOWN_KEY
        ? t('gatekeeper.map.unknownExt')
        : e === OTHER_KEY
          ? t('gatekeeper.map.other')
          : `.${e}`,
  };
}

const extTone = (ext: string): ChartTone => (ext === UNKNOWN_KEY || ext === OTHER_KEY ? 'neutral' : 'accent');

/** Map width below which the ribbons give way to a list. */
const NARROW = 560;

function FlowMap({ flow }: { flow: Flow }) {
  const { t } = useTranslation();
  const [ref, width] = useWidth<HTMLDivElement>();
  const label = useLabels();
  const summary = flow.indexers.map((i) => `${label.ix(i)} ${i.caught}`).join(', ');
  const hasUnknown = flow.extensions.some((e) => e.ext === UNKNOWN_KEY);
  return (
    <div ref={ref} className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t('gatekeeper.map.help')}</p>
      {flow.total === 0 ? (
        <EmptyState title={t('gatekeeper.map.emptyTitle')} body={t('gatekeeper.map.emptyBody')} />
      ) : width === 0 ? (
        <Skeleton className="h-56 rounded-lg" />
      ) : width < NARROW ? (
        <FlowList flow={flow} />
      ) : (
        <FlowRibbons
          flow={flow}
          width={width}
          summary={t('gatekeeper.map.label', { total: flow.total, summary })}
        />
      )}
      {flow.total > 0 && hasUnknown ? (
        <p className="text-xs text-muted">{t('gatekeeper.map.unknownHelp')}</p>
      ) : null}
    </div>
  );
}

interface Node {
  key: string;
  y: number;
  h: number;
  count: number;
}

function FlowRibbons({ flow, width, summary }: { flow: Flow; width: number; summary: string }) {
  const { t } = useTranslation();
  const calm = useCalm();
  const pct = usePercent();
  const label = useLabels();
  const clip = useSvgId('gk-flow');
  const [focus, setFocus] = useState<Focus>(null);

  const layout = useMemo(() => {
    const nodeW = 10;
    const leftW = Math.min(230, Math.round(width * 0.34));
    const rightW = 120;
    const xL = leftW;
    const xR = width - rightW - nodeW;
    const gap = 30;
    const n = Math.max(flow.indexers.length, flow.extensions.length);
    const band = Math.max(120, n * 16);
    const height = band + gap * (n - 1) + 8;
    const unit = Math.min(
      (height - 8 - gap * (flow.indexers.length - 1)) / flow.total,
      (height - 8 - gap * (flow.extensions.length - 1)) / flow.total,
    );
    const stack = (items: Array<{ key: string; count: number }>): Node[] => {
      const used = items.reduce((s, i) => s + i.count * unit, 0) + gap * (items.length - 1);
      let y = (height - used) / 2;
      return items.map((i) => {
        const node = { key: i.key, y, h: i.count * unit, count: i.count };
        y += node.h + gap;
        return node;
      });
    };
    const left = stack(flow.indexers.map((i) => ({ key: i.key, count: i.caught })));
    const right = stack(flow.extensions.map((e) => ({ key: e.ext, count: e.count })));
    const li = new Map(left.map((n, i) => [n.key, i]));
    const ri = new Map(right.map((n, i) => [n.key, i]));
    const outY = new Map(left.map((n) => [n.key, n.y]));
    const inY = new Map(right.map((n) => [n.key, n.y]));
    // Ribbons leave each indexer in the order of the file types and arrive in
    // the order of the indexers, so they never cross at the nodes.
    const ordered = [...flow.links].sort(
      (a, b) => (li.get(a.from) ?? 0) - (li.get(b.from) ?? 0) || (ri.get(a.to) ?? 0) - (ri.get(b.to) ?? 0),
    );
    const sy = new Map<string, number>();
    for (const l of ordered) {
      const h = l.count * unit;
      sy.set(`${l.from}\u0000${l.to}`, outY.get(l.from) ?? 0);
      outY.set(l.from, (outY.get(l.from) ?? 0) + h);
    }
    const byArrival = [...flow.links].sort(
      (a, b) => (ri.get(a.to) ?? 0) - (ri.get(b.to) ?? 0) || (li.get(a.from) ?? 0) - (li.get(b.from) ?? 0),
    );
    const ribbons = byArrival.map((l) => {
      const h = l.count * unit;
      const y0 = sy.get(`${l.from}\u0000${l.to}`) ?? 0;
      const y1 = inY.get(l.to) ?? 0;
      inY.set(l.to, y1 + h);
      const x0 = xL + nodeW;
      const x1 = xR;
      const xm = (x0 + x1) / 2;
      const d = `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}L${x1},${y1 + h}C${xm},${y1 + h} ${xm},${y0 + h} ${x0},${y0 + h}Z`;
      return { ...l, d };
    });
    return { nodeW, xL, xR, height, left, right, ribbons, leftW };
  }, [flow, width]);

  const related = (from: string, to: string) =>
    !focus ||
    (focus.kind === 'ix' && focus.key === from) ||
    (focus.kind === 'ext' && focus.key === to) ||
    (focus.kind === 'link' && focus.from === from && focus.to === to);
  const nodeLit = (kind: 'ix' | 'ext', key: string) =>
    !focus ||
    (focus.kind === kind && focus.key === key) ||
    (focus.kind === 'link' && (kind === 'ix' ? focus.from === key : focus.to === key)) ||
    (focus.kind === 'ix' && kind === 'ext' && flow.links.some((l) => l.from === focus.key && l.to === key)) ||
    (focus.kind === 'ext' && kind === 'ix' && flow.links.some((l) => l.to === focus.key && l.from === key));

  const ixDetail = (i: FlowIndexer) =>
    i.grabs > 0
      ? t('gatekeeper.map.indexerDetail', {
          name: label.ix(i),
          count: i.caught,
          rate: pct(i.rate ?? 0),
          grabs: i.grabs,
        })
      : t('gatekeeper.map.indexerDetailNoGrabs', { name: label.ix(i), count: i.caught });
  const extDetail = (e: { ext: string; count: number }) =>
    t('gatekeeper.map.extDetail', { ext: label.ext(e.ext), count: e.count });

  let caption = t('gatekeeper.map.hint');
  if (focus?.kind === 'ix') {
    const i = flow.indexers.find((x) => x.key === focus.key);
    if (i) caption = ixDetail(i);
  } else if (focus?.kind === 'ext') {
    const e = flow.extensions.find((x) => x.ext === focus.key);
    if (e) caption = extDetail(e);
  } else if (focus?.kind === 'link') {
    const l = flow.links.find((x) => x.from === focus.from && x.to === focus.to);
    const i = flow.indexers.find((x) => x.key === focus.from);
    if (l && i)
      caption = t('gatekeeper.map.linkDetail', { name: label.ix(i), count: l.count, ext: label.ext(l.to) });
  }

  const maxChars = Math.max(8, Math.floor((layout.leftW - 16) / 7.2));
  const cut = (s: string) => (s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s);

  return (
    <div className="flex flex-col gap-2">
      <svg
        width={width}
        height={layout.height}
        viewBox={`0 0 ${width} ${layout.height}`}
        role="group"
        aria-label={summary}
        className="block overflow-visible"
        onPointerLeave={() => setFocus(null)}
      >
        <defs>
          <clipPath id={clip}>
            <motion.rect
              x={0}
              y={-4}
              height={layout.height + 8}
              initial={calm ? false : { width: layout.xL }}
              animate={{ width }}
              transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
            />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clip})`}>
          {layout.ribbons.map((r) => {
            const tone = extTone(r.to);
            const lit = related(r.from, r.to);
            return (
              <path
                key={`${r.from}-${r.to}`}
                d={r.d}
                fill={tint(tone, focus ? (lit ? 62 : 14) : 34)}
                stroke="var(--surface)"
                strokeWidth={1}
                className="transition-[fill] duration-200"
                onPointerEnter={() => setFocus({ kind: 'link', from: r.from, to: r.to })}
              />
            );
          })}
        </g>

        {layout.left.map((n) => {
          const ix = flow.indexers.find((i) => i.key === n.key)!;
          const lit = nodeLit('ix', n.key);
          const cy = n.y + n.h / 2;
          const tone: ChartTone = n.key === UNKNOWN_KEY || n.key === OTHER_KEY ? 'neutral' : 'accent';
          return (
            <g
              key={n.key}
              tabIndex={0}
              aria-label={ixDetail(ix)}
              className="cursor-default outline-none focus-visible:[&>rect]:stroke-[var(--text)]"
              onPointerEnter={() => setFocus({ kind: 'ix', key: n.key })}
              onFocus={() => setFocus({ kind: 'ix', key: n.key })}
              onBlur={() => setFocus(null)}
            >
              <rect
                x={0}
                y={n.y - 4}
                width={layout.xL + layout.nodeW}
                height={Math.max(n.h + 8, 30)}
                fill="transparent"
              />
              <rect
                x={layout.xL}
                y={n.y}
                width={layout.nodeW}
                height={Math.max(n.h, 2)}
                rx={3}
                fill={lit ? toneColor(tone) : tint(tone, 40)}
                strokeWidth={2}
              />
              <text
                x={layout.xL - 10}
                y={cy - 2}
                textAnchor="end"
                className="fill-[var(--text)] text-[13px] font-medium"
              >
                {cut(label.ix(ix))}
              </text>
              <text
                x={layout.xL - 10}
                y={cy + 13}
                textAnchor="end"
                className="fill-[var(--muted)] text-[11px]"
              >
                {ix.grabs > 0
                  ? t('gatekeeper.map.ofGrabs', { rate: pct(ix.rate ?? 0), grabs: ix.grabs })
                  : t('gatekeeper.map.noGrabs')}
              </text>
            </g>
          );
        })}

        {layout.right.map((n) => {
          const lit = nodeLit('ext', n.key);
          const cy = n.y + n.h / 2;
          const tone = extTone(n.key);
          const ext = flow.extensions.find((e) => e.ext === n.key)!;
          return (
            <g
              key={n.key}
              tabIndex={0}
              aria-label={extDetail(ext)}
              className="cursor-default outline-none focus-visible:[&>rect]:stroke-[var(--text)]"
              onPointerEnter={() => setFocus({ kind: 'ext', key: n.key })}
              onFocus={() => setFocus({ kind: 'ext', key: n.key })}
              onBlur={() => setFocus(null)}
            >
              <rect
                x={layout.xR}
                y={n.y - 4}
                width={width - layout.xR}
                height={Math.max(n.h + 8, 24)}
                fill="transparent"
              />
              <rect
                x={layout.xR}
                y={n.y}
                width={layout.nodeW}
                height={Math.max(n.h, 2)}
                rx={3}
                fill={lit ? toneColor(tone) : tint(tone, 40)}
                strokeWidth={2}
              />
              <text
                x={layout.xR + layout.nodeW + 10}
                y={cy + 4}
                className={`fill-[var(--text)] text-[13px] font-medium ${n.key === UNKNOWN_KEY || n.key === OTHER_KEY ? '' : 'font-mono'}`}
              >
                {label.ext(n.key)}
                <tspan dx={8} className="fill-[var(--muted)] font-sans text-[12px] font-normal tabular-nums">
                  {n.count}
                </tspan>
              </text>
            </g>
          );
        })}
      </svg>
      <p className="min-h-5 text-sm text-muted" aria-live="polite">
        {caption}
      </p>
    </div>
  );
}

/** The same map as a list, for narrow screens. */
function FlowList({ flow }: { flow: Flow }) {
  const { t } = useTranslation();
  const calm = useCalm();
  const pct = usePercent();
  const label = useLabels();
  const max = Math.max(1, ...flow.indexers.map((i) => i.caught));
  return (
    <ul className="flex flex-col gap-4">
      {flow.indexers.map((ix, n) => (
        <li key={ix.key} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">{label.ix(ix)}</span>
            <span className="shrink-0 text-xs text-muted tabular-nums">
              {ix.caught} ·{' '}
              {ix.grabs > 0
                ? t('gatekeeper.map.ofGrabs', { rate: pct(ix.rate ?? 0), grabs: ix.grabs })
                : t('gatekeeper.map.noGrabs')}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-surface-2">
            <motion.div
              className="h-full rounded-full bg-accent"
              style={{ width: `${(ix.caught / max) * 100}%`, originX: 0 }}
              initial={calm ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, delay: n * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {flow.links
              .filter((l) => l.from === ix.key)
              .map((l) => (
                <span key={l.to} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
                  <span className={l.to === UNKNOWN_KEY || l.to === OTHER_KEY ? '' : 'font-mono'}>
                    {label.ext(l.to)}
                  </span>{' '}
                  <span className="text-muted tabular-nums">{l.count}</span>
                </span>
              ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ----------------------------------------------------------- indexer impact

const IMPACT_ROWS = 8;

function ImpactCard({ impact, configured }: { impact: Impact[]; configured: boolean }) {
  const { t } = useTranslation();
  const scored = impact.filter((i) => i.scoreWith !== null && i.scoreWithout !== null);
  const shown = scored.slice(0, IMPACT_ROWS);
  const rest = scored.length - shown.length;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-prose text-sm text-muted">{t('gatekeeper.impact.help')}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <li className="flex items-center gap-1.5">
            <span className="size-3 rounded-full border-2 border-[var(--muted)] bg-surface" aria-hidden />
            {t('gatekeeper.impact.without')}
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-3 rounded-full bg-accent" aria-hidden />
            {t('gatekeeper.impact.with')}
          </li>
        </ul>
      </div>
      {!configured ? <p className="text-sm text-muted">{t('gatekeeper.impact.notCounted')}</p> : null}
      {shown.length === 0 ? (
        <p className="text-sm text-muted">{t('gatekeeper.impact.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((i, n) => (
            <ImpactRow key={i.key} item={i} index={n} />
          ))}
        </ul>
      )}
      {rest > 0 ? <p className="text-xs text-muted">{t('gatekeeper.impact.more', { count: rest })}</p> : null}
    </Card>
  );
}

function ImpactRow({ item, index }: { item: Impact; index: number }) {
  const { t } = useTranslation();
  const calm = useCalm();
  const without = item.scoreWithout ?? 0;
  const withScore = item.scoreWith ?? 0;
  const delta = withScore - without;
  const tone: ChartTone = delta > 0 ? 'ok' : delta <= -10 ? 'critical' : 'warning';
  const textTone = delta > 0 ? 'text-ok' : delta <= -10 ? 'text-critical' : 'text-warning';
  const lo = Math.min(without, withScore);
  const aria =
    delta !== 0
      ? t('gatekeeper.impact.row', {
          name: item.name,
          without,
          with: withScore,
          caught: item.caught,
          grabs: item.grabs,
        })
      : t('gatekeeper.impact.rowSame', { name: item.name, with: withScore });
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_4.5rem]">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{item.name}</span>
        <span className="text-xs text-muted">
          {item.caught > 0
            ? t('gatekeeper.impact.caught', { caught: item.caught, grabs: item.grabs })
            : t('gatekeeper.impact.clean')}
        </span>
      </div>
      <div
        className="relative order-3 col-span-2 h-5 sm:order-none sm:col-span-1"
        role="img"
        aria-label={aria}
      >
        <span
          className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-surface-2"
          aria-hidden
        />
        {delta !== 0 ? (
          <>
            <motion.span
              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
              style={{
                left: `${lo}%`,
                width: `${Math.abs(delta)}%`,
                background: toneColor(tone),
                // Grows from the score without blocked downloads towards the new one.
                originX: delta < 0 ? 1 : 0,
              }}
              initial={calm ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, delay: 0.2 + index * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
              aria-hidden
            />
            <span
              className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--muted)] bg-surface"
              style={{ left: `${without}%` }}
              aria-hidden
            />
          </>
        ) : null}
        <motion.span
          className="absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-accent ring-2 ring-[var(--surface)]"
          style={{ marginLeft: '-0.4375rem' }}
          initial={calm ? false : { left: `${without}%` }}
          animate={{ left: `${withScore}%` }}
          transition={{ ...spring, delay: 0.2 + index * 0.05 }}
          aria-hidden
        />
      </div>
      <div className="text-right text-sm tabular-nums" aria-hidden>
        <span className="font-semibold">{withScore}</span>
        {delta !== 0 ? (
          <span className={`ml-1.5 text-xs ${textTone}`}>
            {delta > 0 ? '+' : '−'}
            {Math.abs(delta)}
          </span>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- settings

function initialDraft(data: GatekeeperData): Config | null {
  if (data.configured) return null;
  // First visit: suggest switching on every download client (the recommended level).
  const targets = Object.fromEntries(
    data.targets.filter((x) => x.level === 'downloader').map((x) => [x.instanceId, true]),
  );
  return { ...data.config, targets };
}

function Settings({ data }: { data: GatekeeperData }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [draft, setDraft] = useState<Config | null>(() => initialDraft(data));
  const config = draft ?? data.config;
  const dirty = draft !== null && (!data.configured || !sameConfig(draft, data.config));
  const set = (patch: Partial<Config>) => setDraft({ ...config, ...patch });

  const save = useMutation({
    mutationFn: (body: Config) => api('/api/gatekeeper/settings', { method: 'PUT', body }),
    onSuccess: () => setDraft(null),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['gatekeeper'] });
      void client.invalidateQueries({ queryKey: ['indexerInsights'] });
    },
  });
  const apply = useMutation({
    mutationFn: () => api('/api/gatekeeper/apply', { method: 'POST' }),
    onSettled: () => client.invalidateQueries({ queryKey: ['gatekeeper'] }),
  });
  const needsApply = data.configured && !dirty && data.targets.some((x) => x.enabled && x.sync === 'drift');

  return (
    <>
      <SectionRule
        action={
          needsApply ? (
            <Button variant="ghost" onClick={() => apply.mutate()} busy={apply.isPending}>
              {t('gatekeeper.apply')}
            </Button>
          ) : undefined
        }
      >
        {t('ui.tabs.settings')}
      </SectionRule>
      <div className="grid gap-4 lg:grid-cols-2">
        <ListEditor extensions={config.extensions} onChange={(extensions) => set({ extensions })} />
        <TargetsCard targets={data.targets} checks={data.redownload} config={config} onChange={set} />
      </div>
      {save.isError ? <InlineError {...errorText(t, save.error)} /> : null}
      {apply.isError ? <InlineError {...errorText(t, apply.error)} /> : null}
      {dirty ? (
        <motion.div
          className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3 shadow-lg"
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={spring}
          role="region"
          aria-label={t('gatekeeper.unsaved')}
        >
          <span className="text-sm">{t('gatekeeper.unsaved')}</span>
          <div className="flex gap-2">
            {data.configured ? (
              <Button variant="ghost" onClick={() => setDraft(null)}>
                {t('gatekeeper.discard')}
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => save.mutate(config)} busy={save.isPending}>
              {data.configured ? t('gatekeeper.save') : t('gatekeeper.enable')}
            </Button>
          </div>
        </motion.div>
      ) : null}
    </>
  );
}

function presetState(p: ExtensionPreset, list: Set<string>) {
  const have = p.extensions.filter((e) => list.has(e)).length;
  return { have, state: have === 0 ? 'none' : have === p.extensions.length ? 'all' : 'some' } as const;
}

function ListEditor({ extensions, onChange }: { extensions: string[]; onChange: (v: string[]) => void }) {
  const { t } = useTranslation();
  const calm = useCalm();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | undefined>();
  const list = new Set(extensions);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseExtensionList(text);
    if (!parsed.length) {
      setError(t('gatekeeper.list.invalid'));
      return;
    }
    setError(undefined);
    setText('');
    onChange(uniqueExtensions([...extensions, ...parsed]));
  };

  return (
    <Card className="flex min-w-0 flex-col gap-4">
      <SectionTitle
        action={
          <span className="text-xs text-muted">
            {t('gatekeeper.list.count', { count: extensions.length })}
          </span>
        }
      >
        {t('gatekeeper.list.title')}
      </SectionTitle>
      <p className="-mt-2 text-sm text-muted">{t('gatekeeper.list.help')}</p>

      <div className="grid gap-2 sm:grid-cols-2">
        {EXTENSION_PRESETS.map((p) => {
          const { have, state } = presetState(p, list);
          const name = t(`gatekeeper.presets.${p.id}.name`);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={state === 'all'}
              aria-label={
                state === 'all'
                  ? t('gatekeeper.list.presetRemove', { name })
                  : t('gatekeeper.list.presetAdd', { name })
              }
              onClick={() =>
                onChange(
                  state === 'all'
                    ? extensions.filter((e) => !p.extensions.includes(e))
                    : uniqueExtensions([...extensions, ...p.extensions]),
                )
              }
              className={`flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${state === 'all' ? 'border-accent bg-surface-2' : 'border-border hover:bg-surface-2'}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{name}</span>
                {p.caution ? <Badge tone="warning">{t('gatekeeper.list.caution')}</Badge> : null}
              </span>
              <span className="text-xs text-muted">{t(`gatekeeper.presets.${p.id}.help`)}</span>
              <span className="mt-auto flex items-center gap-2 pt-1">
                <span className="h-1.5 flex-1 rounded-full bg-surface" aria-hidden>
                  <motion.span
                    className="block h-full rounded-full bg-accent"
                    initial={false}
                    animate={{ width: `${(have / p.extensions.length) * 100}%` }}
                    transition={calm ? { duration: 0 } : spring}
                  />
                </span>
                <span className="text-xs text-muted tabular-nums">
                  {t(`gatekeeper.list.presetState.${state}`, { count: have, total: p.extensions.length })}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {extensions.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {extensions.map((ext) => (
            <motion.li
              key={ext}
              layout={!calm}
              initial={calm ? false : { scale: 0.85 }}
              animate={{ scale: 1 }}
              transition={spring}
              className="flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-1 pl-2.5 text-sm"
            >
              <span className="font-mono">.{ext}</span>
              <button
                type="button"
                onClick={() => onChange(extensions.filter((e) => e !== ext))}
                aria-label={t('gatekeeper.list.remove', { ext: `.${ext}` })}
                className="flex size-6 items-center justify-center rounded-full text-muted hover:bg-border hover:text-text focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  aria-hidden
                >
                  <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                </svg>
              </button>
            </motion.li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{t('gatekeeper.list.empty')}</p>
      )}

      <form onSubmit={add} className="flex items-end gap-2">
        <TextField
          className="flex-1"
          label={t('gatekeeper.list.addLabel')}
          placeholder={t('gatekeeper.list.addPlaceholder')}
          value={text}
          error={error}
          onChange={(e) => {
            setText(e.target.value);
            setError(undefined);
          }}
        />
        <Button type="submit" className={error ? 'mb-6' : ''}>
          {t('gatekeeper.list.add')}
        </Button>
      </form>
    </Card>
  );
}

function shortList(t: (k: string, o?: Record<string, unknown>) => string, list: string[], max = 5) {
  const shown = list.slice(0, max).map((e) => `.${e}`);
  const more = list.length - shown.length;
  return more > 0 ? `${shown.join(', ')} ${t('gatekeeper.targets.more', { count: more })}` : shown.join(', ');
}

function TargetsCard({
  targets,
  checks,
  config,
  onChange,
}: {
  targets: Target[];
  checks: RedownloadCheck[];
  config: Config;
  onChange: (patch: Partial<Config>) => void;
}) {
  const { t } = useTranslation();
  const on = (x: Target) => config.targets[x.instanceId] ?? false;
  const setLevel = (level: Target['level']) => {
    const group = targets.filter((x) => x.level === level);
    const all = group.every(on);
    onChange({
      targets: { ...config.targets, ...Object.fromEntries(group.map((x) => [x.instanceId, !all])) },
    });
  };
  const hasSab = targets.some((x) => x.adapter === 'sabnzbd');
  const levels = new Set(targets.map((x) => x.level));
  return (
    <Card className="flex min-w-0 flex-col gap-4">
      <SectionTitle>{t('gatekeeper.targets.title')}</SectionTitle>
      <p className="-mt-2 text-sm text-muted">{t('gatekeeper.targets.help')}</p>
      {targets.length === 0 ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-sm">{t('gatekeeper.targets.none')}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {levels.has('downloader') ? (
              <Button variant="secondary" onClick={() => setLevel('downloader')}>
                {t('gatekeeper.targets.allDownloaders')}
              </Button>
            ) : null}
            {levels.has('arr') ? (
              <Button variant="secondary" onClick={() => setLevel('arr')}>
                {t('gatekeeper.targets.allArrs')}
              </Button>
            ) : null}
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {targets.map((x) => (
              <TargetRow
                key={x.instanceId}
                target={x}
                checked={on(x)}
                onChange={(v) => onChange({ targets: { ...config.targets, [x.instanceId]: v } })}
              />
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-muted">{t('gatekeeper.targets.notSupported')}</p>
      <RedownloadBox checks={checks} />
      <div className="flex flex-col gap-4 rounded-lg bg-surface-2 p-3">
        {hasSab ? (
          <div className="flex flex-col gap-1">
            <Choice
              label={t('gatekeeper.options.sabAction')}
              value={config.sabAction}
              onChange={(sabAction) => onChange({ sabAction })}
              options={[
                ['abort', t('gatekeeper.options.abort')],
                ['pause', t('gatekeeper.options.pause')],
              ]}
            />
            <p className="text-xs text-muted">{t('gatekeeper.options.sabActionHelp')}</p>
          </div>
        ) : null}
        <Toggle
          label={t('gatekeeper.options.autoRepair')}
          help={t('gatekeeper.options.autoRepairHelp')}
          checked={config.autoRepair}
          onChange={(autoRepair) => onChange({ autoRepair })}
        />
      </div>
    </Card>
  );
}

/**
 * A blocked download is only replaced when the *arr app blocklists the
 * failed download and searches again (Failed Download Handling).
 */
function RedownloadBox({ checks }: { checks: RedownloadCheck[] }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const enable = useMutation({
    mutationFn: (instanceId: string) =>
      api('/api/gatekeeper/redownload', { method: 'POST', body: { instanceId } }),
    onSettled: () => client.invalidateQueries({ queryKey: ['gatekeeper'] }),
  });
  const read = checks.filter((c) => c.redownload !== null);
  if (!read.length) return null;
  const off = read.filter((c) => !c.redownload || c.completedHandling === false);
  const fine = read.filter((c) => !off.includes(c));
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{t('gatekeeper.redownload.title')}</span>
        <span className="text-xs text-muted">{t('gatekeeper.redownload.help')}</span>
      </div>
      {off.length ? (
        <ul className="flex flex-col gap-2">
          {off.map((c) => (
            <li key={c.instanceId} className="flex items-center gap-3">
              <ServiceLogo adapter={c.adapter} name={c.name} size={22} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 text-sm">
                  <StatusDot tone="warning" label={t('gatekeeper.redownload.offLabel')} />
                  <span className="truncate">{c.name}</span>
                </span>
                <span className="text-xs text-muted">
                  {c.completedHandling === false
                    ? t('gatekeeper.redownload.noCompleted', { name: c.name })
                    : t('gatekeeper.redownload.off', { name: c.name })}
                </span>
              </div>
              {c.completedHandling !== false ? (
                <Button
                  onClick={() => enable.mutate(c.instanceId)}
                  busy={enable.isPending && enable.variables === c.instanceId}
                >
                  {t('gatekeeper.redownload.enable')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {fine.length ? (
        <p className="flex items-center gap-2 text-xs text-muted">
          <StatusDot tone="ok" label={t('gatekeeper.redownload.onLabel')} />
          {t('gatekeeper.redownload.on', { names: fine.map((c) => c.name).join(', ') })}
        </p>
      ) : null}
      {enable.isError ? <InlineError {...errorText(t, enable.error)} /> : null}
    </div>
  );
}

function TargetRow({
  target: x,
  checked,
  onChange,
}: {
  target: Target;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const s = x.status;
  const details: string[] = [];
  if (x.sync === 'error') details.push(t('gatekeeper.targets.detail.error'));
  else if (x.sync === 'blocked' && s?.blocker) details.push(t(`gatekeeper.targets.detail.${s.blocker}`));
  else details.push(t(`gatekeeper.targets.detail.${x.level}`));
  if (x.enabled && x.sync === 'drift' && x.missing.length)
    details.push(t('gatekeeper.targets.detail.drift', { list: shortList(t, x.missing) }));
  if (x.unreachable.length && (checked || x.enabled) && x.sync !== 'blocked')
    details.push(
      t('gatekeeper.targets.detail.partial', {
        count: x.unreachable.length,
        list: shortList(t, x.unreachable),
      }),
    );
  if (s?.style === 'groups' && s.indexers && x.enabled)
    details.push(t('gatekeeper.targets.detail.indexers', s.indexers));
  if (x.lastApplied?.error)
    details.push(
      t('gatekeeper.targets.detail.applyFailed', { when: formatRelative(x.lastApplied.at, i18n.language) }),
    );
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className="pt-0.5">
        <ServiceLogo adapter={x.adapter} name={x.name} size={28} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Toggle
          label={x.name}
          help={details.join(' ')}
          checked={checked}
          disabled={x.sync === 'blocked' && !x.enabled}
          onChange={onChange}
        />
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="neutral">
            {t(`gatekeeper.targets.level.${x.level}`)}
            {x.recommended ? ` · ${t('gatekeeper.targets.recommended')}` : ''}
          </Badge>
          <Badge tone={SYNC_TONE[x.sync]}>{t(`gatekeeper.targets.sync.${x.sync}`)}</Badge>
        </div>
      </div>
    </li>
  );
}

// ------------------------------------------------------------ recent catches

const RECENT_ROWS = 8;

function RecentList({ recent }: { recent: Catch[] }) {
  const { t, i18n } = useTranslation();
  const calm = useCalm();
  const [all, setAll] = useState(false);
  const shown = all ? recent : recent.slice(0, RECENT_ROWS);
  if (!recent.length)
    return (
      <Card>
        <p className="text-sm text-muted">{t('gatekeeper.recent.empty')}</p>
      </Card>
    );
  return (
    <Card className="p-0">
      <ul className="divide-y divide-border">
        {shown.map((c, n) => (
          <motion.li
            key={c.downloadId}
            className="flex flex-col gap-1.5 px-5 py-3 sm:flex-row sm:items-center sm:gap-4"
            initial={calm ? false : { y: 6, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ ...spring, delay: Math.min(n, 10) * 0.03 }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium" title={c.name}>
                {c.name}
              </span>
              <span className="text-xs text-muted">
                {formatRelative(c.at, i18n.language)} ·{' '}
                {c.indexer
                  ? t('gatekeeper.recent.from', { name: c.indexer.name })
                  : t('gatekeeper.recent.unknownIndexer')}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {c.extensions.length ? (
                c.extensions.map((e) => (
                  <span key={e} className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-xs">
                    .{e}
                  </span>
                ))
              ) : (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
                  {t('gatekeeper.recent.unknownExt')}
                </span>
              )}
              <Badge tone="warning">{t(`gatekeeper.recent.outcome.${c.outcome}`)}</Badge>
              <span
                className="flex items-center gap-1"
                title={t('gatekeeper.recent.seenBy', { names: c.seenBy.map((s) => s.name).join(', ') })}
              >
                {c.seenBy.map((s) => (
                  <ServiceLogo key={s.instanceId} adapter={s.adapter} name={s.name} size={18} />
                ))}
                <span className="sr-only">
                  {t('gatekeeper.recent.seenBy', { names: c.seenBy.map((s) => s.name).join(', ') })}
                </span>
              </span>
            </div>
          </motion.li>
        ))}
      </ul>
      {recent.length > shown.length ? (
        <div className="border-t border-border px-5 py-2">
          <Button variant="ghost" onClick={() => setAll(true)}>
            {t('gatekeeper.recent.showAll', { count: recent.length })}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
