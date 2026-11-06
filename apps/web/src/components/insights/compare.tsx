// Comparing indexers: the speed/reliability map, the ranked table with
// expandable details, and the outage strips.
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatBytes } from '../../lib/format';
import {
  compact,
  delta,
  minutes,
  ms,
  number,
  percent,
  pointLabel,
  successTone,
  type InsightsReport,
  type TrackerRow,
} from '../../lib/insights';
import { ProgressRing, Sparkline, tint, toneColor, useCalm } from '../charts';
import { Scatter } from '../Scatter';
import { ServiceLogo } from '../ServiceLogo';
import { Badge, Card, spring } from '../ui';
import { CellGlyph } from './sources';

// ---------------------------------------------------------------- speed map

export function SpeedMap({ report, onSelect }: { report: InsightsReport; onSelect: (key: string) => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const points = report.trackers
    .filter((r) => r.metrics.successRate !== null && r.metrics.averageResponseMs !== null)
    .map((r) => ({
      key: r.key,
      name: r.name,
      x: r.metrics.averageResponseMs!,
      y: r.metrics.successRate!,
      size: r.metrics.grabs + r.metrics.arrGrabs,
      tone: r.failing ? ('critical' as const) : ('accent' as const),
      tooltip: (
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold">{r.name}</span>
          <span className="text-muted">
            {percent(r.metrics.successRate, lang)} {t('insights.table.success').toLowerCase()} ·{' '}
            {ms(r.metrics.averageResponseMs, lang)}
          </span>
          <span className="text-muted">
            {number(r.metrics.grabs, lang)} {t('insights.table.grabs')}
          </span>
        </span>
      ),
    }));
  const minY = Math.min(0.5, ...points.map((p) => Math.floor(p.y * 10) / 10));
  const maxX = Math.max(10_000, ...points.map((p) => p.x));
  const yTicks: Array<[number, string]> = [];
  for (let v = 1; v >= minY - 1e-9; v -= minY < 0.3 ? 0.25 : 0.1) yTicks.push([v, percent(v, lang)]);
  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h3 className="font-semibold">{t('insights.scatter.title')}</h3>
        <p className="text-sm text-muted">{t('insights.scatter.intro')}</p>
      </div>
      {points.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">{t('insights.scatter.empty')}</p>
      ) : (
        <Scatter
          points={points}
          label={t('insights.scatter.label')}
          xLog
          xDomain={[100, maxX]}
          yDomain={[minY, 1]}
          xTicks={[100, 300, 1000, 3000, 10_000].filter((v) => v <= maxX).map((v) => [v, ms(v, lang)])}
          yTicks={yTicks}
          xTitle={t('insights.scatter.x')}
          yTitle={t('insights.scatter.y')}
          corners={{ best: t('insights.scatter.best'), worst: t('insights.scatter.worst') }}
          onSelect={onSelect}
        />
      )}
    </Card>
  );
}

// -------------------------------------------------------------------- table

type SortKey = 'score' | 'searches' | 'grabs' | 'success' | 'response' | 'uptime' | 'imports';

const SORT: Record<SortKey, (r: TrackerRow) => number | null> = {
  score: (r) => r.metrics.score,
  searches: (r) => r.metrics.queries,
  grabs: (r) => r.metrics.grabs + r.metrics.arrGrabs,
  success: (r) => r.metrics.successRate,
  // Faster first.
  response: (r) => (r.metrics.averageResponseMs === null ? null : -r.metrics.averageResponseMs),
  uptime: (r) => r.metrics.uptime,
  imports: (r) => r.metrics.importRate,
};

const COLS =
  'grid-cols-[minmax(0,1fr)_3rem] sm:grid-cols-[minmax(0,1.6fr)_3rem_repeat(3,minmax(0,1fr))] lg:grid-cols-[minmax(0,1.6fr)_3rem_repeat(6,minmax(0,1fr))]';

export function IndexerTable({
  report,
  open,
  onToggle,
}: {
  report: InsightsReport;
  open: string | null;
  onToggle: (key: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [sort, setSort] = useState<SortKey>('score');
  const rows = useMemo(
    () =>
      [...report.trackers].sort((a, b) => {
        const va = SORT[sort](a);
        const vb = SORT[sort](b);
        if (va === null && vb === null) return a.name.localeCompare(b.name);
        if (va === null) return 1;
        if (vb === null) return -1;
        return vb - va || a.name.localeCompare(b.name);
      }),
    [report.trackers, sort],
  );
  const maxQueries = Math.max(1, ...rows.map((r) => r.metrics.queries));
  const maxGrabs = Math.max(1, ...rows.map((r) => r.metrics.grabs + r.metrics.arrGrabs));
  const headers: Array<[SortKey, string, string]> = [
    ['score', t('insights.table.score'), ''],
    ['searches', t('insights.table.searches'), 'hidden sm:flex'],
    ['grabs', t('insights.table.grabs'), 'hidden sm:flex'],
    ['success', t('insights.table.success'), 'hidden sm:flex'],
    ['response', t('insights.table.response'), 'hidden lg:flex'],
    ['uptime', t('insights.table.uptime'), 'hidden lg:flex'],
    ['imports', t('insights.table.imports'), 'hidden lg:flex'],
  ];

  return (
    <Card className="!p-0">
      <div role="table" aria-label={t('insights.table.label')}>
        <div role="rowgroup">
          <div
            role="row"
            className={`grid ${COLS} items-end gap-3 border-b border-border px-5 py-3 text-xs text-muted`}
          >
            <span role="columnheader">{t('insights.table.indexer')}</span>
            {headers.map(([key, label, cls]) => (
              <span
                key={key}
                role="columnheader"
                aria-sort={sort === key ? 'descending' : 'none'}
                className={`${cls} justify-end`}
              >
                <button
                  type="button"
                  onClick={() => setSort(key)}
                  aria-label={t('insights.table.sortBy', { column: label })}
                  title={key === 'score' ? t('insights.table.scoreHelp') : undefined}
                  className={`rounded px-1 font-medium hover:text-text ${sort === key ? 'text-text' : ''}`}
                >
                  {label}
                  {sort === key ? ' ↓' : ''}
                </button>
              </span>
            ))}
          </div>
        </div>
        <div role="rowgroup" className="divide-y divide-border">
          {rows.map((r, i) => (
            <TableRow
              key={r.key}
              row={r}
              report={report}
              index={i}
              open={open === r.key}
              onToggle={() => onToggle(r.key)}
              maxQueries={maxQueries}
              maxGrabs={maxGrabs}
              lang={lang}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

function MeterCell({
  value,
  max,
  text,
  className = '',
}: {
  value: number;
  max: number;
  text: string;
  className?: string;
}) {
  const calm = useCalm();
  return (
    <span role="cell" className={`${className} flex-col items-end gap-1`}>
      <span className="text-sm tabular-nums">{text}</span>
      <span className="h-1.5 w-full max-w-20 rounded-full bg-surface-2">
        <motion.span
          className="block h-full rounded-full bg-accent"
          style={{ width: `${(value / max) * 100}%`, originX: 0 }}
          initial={calm ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </span>
    </span>
  );
}

const TONE_TEXT = {
  ok: 'text-text',
  warning: 'text-warning',
  critical: 'text-critical',
  neutral: 'text-muted',
};

function TableRow({
  row,
  report,
  index,
  open,
  onToggle,
  maxQueries,
  maxGrabs,
  lang,
}: {
  row: TrackerRow;
  report: InsightsReport;
  index: number;
  open: boolean;
  onToggle: () => void;
  maxQueries: number;
  maxGrabs: number;
  lang: string;
}) {
  const { t } = useTranslation();
  const m = row.metrics;
  const grabs = m.grabs + m.arrGrabs;
  const uptimeTone =
    m.uptime === null ? 'neutral' : m.uptime < 0.9 ? 'critical' : m.uptime < 0.99 ? 'warning' : 'ok';
  const importTone = m.importRate === null ? 'neutral' : m.importRate < 0.5 ? 'warning' : 'ok';
  return (
    <motion.div
      id={`indexer-${row.key}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: Math.min(0.4, index * 0.03) }}
    >
      <div
        role="row"
        className={`grid ${COLS} items-center gap-3 px-5 py-3 ${open ? '' : 'hover:bg-[color-mix(in_oklab,var(--surface-2)_50%,var(--surface))]'}`}
      >
        <span role="rowheader" className="min-w-0">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={t('insights.table.details', { name: row.name })}
            className="flex w-full min-w-0 items-center gap-2 text-left"
          >
            <motion.svg
              viewBox="0 0 24 24"
              className="size-4 shrink-0 text-muted"
              animate={{ rotate: open ? 90 : 0 }}
              transition={spring}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              <path d="m9 6 6 6-6 6" />
            </motion.svg>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{row.name}</span>
                {row.failing ? <Badge tone="critical">{t('insights.table.failing')}</Badge> : null}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted">
                {t(`insights.table.protocol.${row.protocol}`)}
                {row.privacy ? ` · ${t(`insights.table.privacy.${row.privacy}`)}` : ''}
                {row.apps.length > 0 ? (
                  <span className="ml-1 inline-flex items-center gap-0.5">
                    {row.apps.map((a) => (
                      <CellGlyph key={a.instanceId} state={a.state} size={10} />
                    ))}
                  </span>
                ) : !row.present ? (
                  ` · ${t('insights.matrix.gone')}`
                ) : null}
              </span>
            </span>
          </button>
        </span>
        <span role="cell" className="flex justify-end">
          <ProgressRing
            value={(m.score ?? 0) / 100}
            size={38}
            tone={m.score === null ? 'neutral' : 'accent'}
            label={`${t('insights.table.score')} ${m.score ?? '–'}`}
          >
            {m.score ?? '–'}
          </ProgressRing>
        </span>
        <MeterCell
          className="hidden sm:flex"
          value={m.queries}
          max={maxQueries}
          text={compact(m.queries, lang)}
        />
        <MeterCell className="hidden sm:flex" value={grabs} max={maxGrabs} text={compact(grabs, lang)} />
        <span
          role="cell"
          className={`hidden justify-end text-sm tabular-nums sm:flex ${TONE_TEXT[successTone(m.successRate)]}`}
        >
          {percent(m.successRate, lang, 1)}
        </span>
        <span role="cell" className="hidden justify-end lg:flex">
          <ResponseLollipop value={m.averageResponseMs} lang={lang} />
        </span>
        <span
          role="cell"
          className={`hidden justify-end text-sm tabular-nums lg:flex ${TONE_TEXT[uptimeTone]}`}
        >
          {percent(m.uptime, lang, 1)}
        </span>
        <span
          role="cell"
          className={`hidden justify-end text-sm tabular-nums lg:flex ${TONE_TEXT[importTone]}`}
        >
          {percent(m.importRate, lang)}
        </span>
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="details"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <Details row={row} report={report} lang={lang} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

/** Answer time as a dot on a log track from 100 ms to 10 s. */
function ResponseLollipop({ value, lang }: { value: number | null; lang: string }) {
  if (value === null) return <span className="text-sm text-muted">–</span>;
  const share = Math.max(0, Math.min(1, (Math.log10(Math.max(value, 100)) - 2) / 2));
  return (
    <span className="flex w-full max-w-24 flex-col items-end gap-1">
      <span className="text-sm tabular-nums">{ms(value, lang)}</span>
      <span className="relative h-1.5 w-full">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        <span
          className="absolute top-1/2 left-0 h-0.5 -translate-y-1/2 bg-accent"
          style={{ width: `${share * 100}%` }}
        />
        <span
          className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent"
          style={{ left: `${share * 100}%` }}
        />
      </span>
    </span>
  );
}

function Details({ row, report, lang }: { row: TrackerRow; report: InsightsReport; lang: string }) {
  const { t } = useTranslation();
  const m = row.metrics;
  const label = (i: number) => (report.points[i] ? pointLabel(report.points[i], report.stepMs, lang) : '');
  const responses = row.series.responseMs.map((v) => v ?? 0);
  const change = delta(m.queries, row.previous.queries, lang, 'relative');
  const appName = new Map(report.apps.map((a) => [a.instanceId, a]));
  return (
    <div className="grid gap-5 border-t border-border bg-[color-mix(in_oklab,var(--surface-2)_45%,var(--surface))] px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
          {t('insights.table.trendSearches')}
        </span>
        <Sparkline
          values={row.series.queries}
          height={48}
          label={t('insights.table.trendSearches')}
          pointLabel={label}
          format={(n) => number(n, lang)}
        />
        {change ? (
          <span className="text-xs text-muted">{t('insights.table.versus', { delta: change })}</span>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
          {t('insights.table.trendResponse')}
        </span>
        {responses.some((v) => v > 0) ? (
          <Sparkline
            values={responses}
            height={48}
            label={t('insights.table.trendResponse')}
            pointLabel={label}
            format={(n) => ms(n, lang)}
          />
        ) : (
          <span className="text-sm text-muted">–</span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
          {t('insights.sections.outages')}
        </span>
        {m.uptime !== null ? (
          <>
            <OutageStrip row={row} report={report} lang={lang} />
            <span className="text-xs text-muted">
              {m.outages > 0
                ? t('insights.table.outages', { count: m.outages, time: minutes(m.downMs / 60_000, lang) })
                : t('insights.table.noOutages')}
            </span>
          </>
        ) : (
          <span className="text-sm text-muted">–</span>
        )}
        {m.medianImportMinutes !== null ? (
          <span className="text-xs text-muted">
            {t('insights.table.importTime', { time: minutes(m.medianImportMinutes, lang) })}
          </span>
        ) : null}
        {m.grabbedBytes > 0 ? (
          <span className="text-xs text-muted">
            {t('insights.table.size', { size: formatBytes(m.grabbedBytes) })}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">
          {t('insights.table.inApps')}
        </span>
        {row.apps.length === 0 ? (
          <span className="text-sm text-muted">
            {row.present ? t('insights.matrix.none') : t('insights.matrix.gone')}
          </span>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {row.apps.map((a) => {
              const app = appName.get(a.instanceId);
              return (
                <li key={a.instanceId} className="flex items-center gap-2">
                  {app ? <ServiceLogo adapter={app.adapter} name={app.instanceName} size={16} /> : null}
                  <span className="min-w-0 truncate">{app?.instanceName ?? a.instanceId}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted">
                    <CellGlyph state={a.state} size={10} />
                    {t(`insights.source.${a.state}`)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {!row.enabled && row.prowlarr ? (
          <span className="text-xs text-muted">{t('insights.table.disabled')}</span>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ outages

function spanText(start: string, end: string, report: InsightsReport, lang: string, t: TFunction) {
  const f = new Intl.DateTimeFormat(lang, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const open = Date.parse(end) >= Date.parse(report.generatedAt) - 60_000;
  return t('insights.outages.span', {
    from: f.format(new Date(start)),
    to: open ? t('insights.outages.now') : f.format(new Date(end)),
  });
}

/** One indexer's range as a strip: up in a quiet green, outages in red. */
export function OutageStrip({
  row,
  report,
  lang,
}: {
  row: TrackerRow;
  report: InsightsReport;
  lang: string;
}) {
  const { t } = useTranslation();
  const calm = useCalm();
  const from = Date.parse(report.from);
  const to = Math.min(Date.parse(report.to), Date.parse(report.generatedAt));
  const span = Math.max(1, to - from);
  // Before Wardarr first saw the indexer nothing is known: that part stays grey.
  const watched = row.observedFrom
    ? Math.min(100, Math.max(0, ((Date.parse(row.observedFrom) - from) / span) * 100))
    : 0;
  return (
    <span
      className="relative block h-3 w-full overflow-hidden rounded-full"
      style={{
        background: `linear-gradient(to right, var(--surface-2) ${watched}%, ${tint('ok', 28)} ${watched}%)`,
      }}
      role="img"
      aria-label={`${row.name}: ${row.downtime.map((d) => spanText(d.start, d.end, report, lang, t)).join(', ') || t('insights.table.noOutages')}`}
    >
      {row.downtime.map((d, i) => {
        const left = ((Date.parse(d.start) - from) / span) * 100;
        const width = Math.max(0.8, ((Date.parse(d.end) - Date.parse(d.start)) / span) * 100);
        return (
          <motion.span
            key={d.start}
            title={spanText(d.start, d.end, report, lang, t)}
            className="absolute inset-y-0 rounded-full"
            style={{ left: `${left}%`, width: `${width}%`, background: toneColor('critical'), originX: 0 }}
            initial={calm ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.4, delay: 0.1 + i * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
          />
        );
      })}
    </span>
  );
}

export function OutageBoard({ report }: { report: InsightsReport }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const rows = report.trackers
    .filter((r) => r.metrics.uptime !== null)
    .sort((a, b) => b.metrics.downMs - a.metrics.downMs || a.name.localeCompare(b.name));
  const f = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });
  const anyDown = rows.some((r) => r.downtime.length > 0);
  const unwatched = rows.some((r) => r.observedFrom && Date.parse(r.observedFrom) > Date.parse(report.from));
  return (
    <Card className="flex flex-col gap-3">
      <h3 className="font-semibold">{t('insights.sections.outages')}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t('insights.outages.noData')}</p>
      ) : (
        <>
          {!anyDown ? <p className="text-sm text-muted">{t('insights.outages.none')}</p> : null}
          <ul className="flex flex-col gap-2.5" aria-label={t('insights.outages.label')}>
            {rows.map((r) => (
              <li
                key={r.key}
                className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm"
              >
                <span className="truncate">{r.name}</span>
                <OutageStrip row={r} report={report} lang={lang} />
                <span
                  className={`text-right text-xs tabular-nums ${r.metrics.uptime! < 0.99 ? 'text-warning' : 'text-muted'}`}
                >
                  {percent(r.metrics.uptime, lang, 1)}
                </span>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_3.5rem] gap-3 text-[10px] text-muted">
            <span />
            <span className="flex justify-between">
              <span>{f.format(new Date(report.from))}</span>
              <span>{t('insights.outages.now')}</span>
            </span>
            <span />
          </div>
          {unwatched ? <p className="text-xs text-muted">{t('insights.outages.unwatched')}</p> : null}
        </>
      )}
    </Card>
  );
}
