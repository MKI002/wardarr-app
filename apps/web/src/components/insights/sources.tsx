// Where indexers come from: one card per app and the indexers x apps matrix.
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import {
  CELL_TONE,
  DIRECT_COLOR,
  type AppReport,
  type CellState,
  type InsightsReport,
} from '../../lib/insights';
import { MiniBars } from '../dash';
import { SegmentBar, toneColor, useCalm } from '../charts';
import { ServiceLogo } from '../ServiceLogo';
import { Badge, Card, StatusDot, spring, type Tone } from '../ui';

const MODE_TONE: Record<AppReport['mode'], Tone> = {
  prowlarr: 'neutral',
  direct: 'neutral',
  mixed: 'info',
  none: 'neutral',
  unknown: 'warning',
};

/** The mark of a matrix cell. Shape carries the state too, so colour is never alone. */
export function CellGlyph({ state, size = 14 }: { state: CellState | null; size?: number }) {
  const r = size / 2;
  const c = size / 2;
  const accent = toneColor('accent');
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
      {state === 'synced' ? <circle cx={c} cy={c} r={r - 1} fill={accent} /> : null}
      {state === 'direct' ? (
        <circle cx={c} cy={c} r={r - 2} fill={DIRECT_COLOR} stroke={accent} strokeWidth={2} />
      ) : null}
      {state === 'both' ? (
        <>
          <circle cx={c - 2.5} cy={c} r={r - 3} fill={toneColor(CELL_TONE.both)} />
          <circle
            cx={c + 2.5}
            cy={c}
            r={r - 3}
            fill={toneColor(CELL_TONE.both)}
            stroke="var(--surface)"
            strokeWidth={1.5}
          />
        </>
      ) : null}
      {state === 'missing' ? (
        <circle
          cx={c}
          cy={c}
          r={r - 1.5}
          fill="none"
          stroke={toneColor('critical')}
          strokeWidth={1.75}
          strokeDasharray="2.5 2"
        />
      ) : null}
      {state === 'off' ? (
        <rect x={2} y={c - 1} width={size - 4} height={2} rx={1} fill={toneColor('neutral')} />
      ) : null}
      {state === null ? <circle cx={c} cy={c} r={1.75} fill="var(--border)" /> : null}
    </svg>
  );
}

export function CellLegend() {
  const { t } = useTranslation();
  const states: CellState[] = ['synced', 'direct', 'both', 'missing', 'off'];
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
      {states.map((s) => (
        <li key={s} className="flex items-center gap-1.5">
          <CellGlyph state={s} size={12} />
          {t(`insights.source.${s}`)}
        </li>
      ))}
    </ul>
  );
}

/** Entries of one or more apps split by source; duplicates and missing ones count apart. */
export function sourceCounts(apps: AppReport[]) {
  const out = { synced: 0, direct: 0, both: 0, missing: 0 };
  for (const a of apps) {
    for (const ix of a.indexers) {
      if (ix.flags.includes('duplicate')) out.both++;
      else if (ix.source === 'prowlarr') out.synced++;
      else out.direct++;
    }
    out.missing += a.missing.length;
  }
  return out;
}

export function sourceSegments(t: (k: string) => string, apps: AppReport[]) {
  const c = sourceCounts(apps);
  return [
    { key: 'synced', label: t('insights.source.synced'), value: c.synced, tone: 'accent' as const },
    {
      key: 'direct',
      label: t('insights.source.direct'),
      value: c.direct,
      tone: 'accent' as const,
      shade: 0.6,
    },
    { key: 'both', label: t('insights.source.both'), value: c.both, tone: 'warning' as const },
    { key: 'missing', label: t('insights.source.missing'), value: c.missing, tone: 'critical' as const },
  ];
}

export function AppSourceCard({ app, index }: { app: AppReport; index: number }) {
  const { t, i18n } = useTranslation();
  const flagged = app.indexers.filter((i) => i.flags.length > 0);
  const history = app.history.map((h) => h.synced + h.direct);
  return (
    <motion.div
      className="min-w-0"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 0.04 * index }}
    >
      <Card as="article" className="flex h-full flex-col gap-3">
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <ServiceLogo adapter={app.adapter} name={app.instanceName} size={28} />
            <div className="min-w-0">
              <h3 className="truncate font-semibold">{app.instanceName}</h3>
              <p className="truncate text-xs text-muted">
                {app.prowlarrApp
                  ? `${t('insights.app.via', { prowlarr: app.prowlarrApp.prowlarrName, app: app.prowlarrApp.appName })}${
                      app.prowlarrApp.syncLevel
                        ? ` · ${t(`insights.app.syncLevel.${app.prowlarrApp.syncLevel}`)}`
                        : ''
                    }`
                  : t('insights.app.notInProwlarr')}
              </p>
            </div>
          </div>
          <Badge tone={MODE_TONE[app.mode]}>{t(`insights.app.mode.${app.mode}`)}</Badge>
        </header>

        {app.error ? (
          <p className="text-sm text-warning">
            {t('insights.app.error', { reason: t(`ui.instance.testFailed.${app.error}`) })}
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-3xl font-semibold tracking-tight tabular-nums">{app.counts.total}</span>
              <span className="text-xs text-muted">
                {t('insights.app.counts', { synced: app.counts.synced, direct: app.counts.direct })}
              </span>
            </div>
            <SegmentBar label={app.instanceName} segments={sourceSegments(t, [app])} />
          </>
        )}

        {flagged.length > 0 || app.missing.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {flagged.map((ix) => {
              const flag = ix.flags.includes('duplicate')
                ? 'both'
                : ix.flags.includes('orphan')
                  ? 'orphan'
                  : ix.flags.includes('searchOff')
                    ? 'off'
                    : 'synced';
              const tone: Tone = flag === 'both' || flag === 'orphan' ? 'warning' : 'neutral';
              const label =
                flag === 'off'
                  ? t('insights.app.searchOff')
                  : flag === 'orphan'
                    ? t('insights.source.orphan')
                    : flag === 'both'
                      ? t('insights.source.both')
                      : t(`insights.app.evidence.${ix.evidence}`);
              return (
                <li key={ix.id} className="flex items-center gap-2">
                  <StatusDot tone={tone} label={label} />
                  <span className="min-w-0 truncate">{ix.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted">{label}</span>
                </li>
              );
            })}
            {app.missing.map((m) => (
              <li key={m.key} className="flex items-center gap-2">
                <StatusDot tone="critical" label={t('insights.source.missing')} />
                <span className="min-w-0 truncate">{m.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted">{t('insights.source.missing')}</span>
              </li>
            ))}
          </ul>
        ) : null}

        <footer className="mt-auto flex items-end justify-between gap-3 pt-1 text-xs text-muted">
          <span>
            {t('insights.app.grabs', {
              total: new Intl.NumberFormat(i18n.language).format(app.grabs.total),
              imported: new Intl.NumberFormat(i18n.language).format(app.grabs.imported),
            })}
          </span>
          {history.length >= 2 ? (
            <MiniBars values={history} height={24} label={t('insights.app.history')} />
          ) : null}
        </footer>
      </Card>
    </motion.div>
  );
}

/** Rows are indexers (sites), columns are apps; each cell says how the site gets into the app. */
export function SourceMatrix({
  report,
  onSelect,
}: {
  report: InsightsReport;
  onSelect: (key: string) => void;
}) {
  const { t } = useTranslation();
  const calm = useCalm();
  const apps = report.apps.filter((a) => a.mode !== 'unknown');
  const rows = report.trackers.filter((tr) => tr.present);
  if (apps.length === 0 || rows.length === 0) return null;
  const stateOf = (key: string, instanceId: string) =>
    rows.find((r) => r.key === key)?.apps.find((a) => a.instanceId === instanceId)?.state ?? null;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">{t('insights.matrix.title')}</h3>
        <CellLegend />
      </div>
      <div className="-mx-5 overflow-x-auto px-5">
        <table
          className="w-full border-separate border-spacing-0 text-sm"
          aria-label={t('insights.matrix.label')}
        >
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 bg-surface pr-4 pb-2 text-left text-xs font-medium text-muted"
              >
                {t('insights.matrix.indexer')}
              </th>
              {apps.map((a) => (
                <th
                  key={a.instanceId}
                  scope="col"
                  className="px-2 pb-2 text-center text-xs font-medium text-muted"
                >
                  <span className="flex flex-col items-center gap-1">
                    <ServiceLogo adapter={a.adapter} name={a.instanceName} size={18} />
                    <span className="max-w-24 truncate">{a.instanceName}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r.key} className="group">
                <th
                  scope="row"
                  className="sticky left-0 border-t border-border bg-surface py-2 pr-4 text-left font-normal"
                >
                  <button
                    type="button"
                    onClick={() => onSelect(r.key)}
                    className="flex max-w-56 items-center gap-2 truncate text-left hover:text-accent"
                  >
                    {r.failing ? <StatusDot tone="critical" label={t('insights.table.failing')} /> : null}
                    <span className="truncate">{r.name}</span>
                  </button>
                </th>
                {apps.map((a, ci) => {
                  const state = stateOf(r.key, a.instanceId);
                  const text = state ? t(`insights.source.${state}`) : t('insights.matrix.none');
                  return (
                    <td key={a.instanceId} className="border-t border-border px-2 py-2 text-center">
                      <motion.span
                        className="inline-grid place-items-center"
                        role="img"
                        aria-label={t('insights.matrix.cell', {
                          indexer: r.name,
                          app: a.instanceName,
                          state: text,
                        })}
                        title={t('insights.matrix.cell', {
                          indexer: r.name,
                          app: a.instanceName,
                          state: text,
                        })}
                        initial={calm ? false : { scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{
                          type: 'spring',
                          stiffness: 420,
                          damping: 22,
                          delay: 0.05 + (ri + ci) * 0.025,
                        }}
                      >
                        <CellGlyph state={state} />
                      </motion.span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
