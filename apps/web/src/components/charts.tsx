// Small charts and widgets for the dashboards. Everything is plain SVG or
// HTML styled with the theme tokens, so both themes work without extra
// colours. Status colours only ever mean status; magnitudes use the accent.
//
// Motion follows the same rules as the rest of the UI: short springy
// entrances (150-600 ms), nothing is hidden while it animates, and the
// reduced-motion setting (system or Wardarr's own) turns all of it off.
import { motion, useReducedMotionConfig } from 'motion/react';
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { Tone } from './ui';

export type ChartTone = Tone | 'accent';

/** The CSS colour of a tone, for SVG fills and strokes. */
export function toneColor(tone: ChartTone): string {
  if (tone === 'neutral') return 'var(--muted)';
  if (tone === 'warning') return 'var(--warning-mark)';
  return `var(--${tone})`;
}

export const BG_TONE: Record<ChartTone, string> = {
  critical: 'bg-critical',
  warning: 'bg-warning-mark',
  info: 'bg-info',
  ok: 'bg-ok',
  neutral: 'bg-muted',
  accent: 'bg-accent',
};

/** A lighter step of a tone, mixed with the card surface (solid, no transparency). */
export function tint(tone: ChartTone, percent: number): string {
  return `color-mix(in oklab, ${toneColor(tone)} ${Math.round(percent)}%, var(--surface))`;
}

/** True when animations should be skipped. */
export function useCalm(): boolean {
  return useReducedMotionConfig() === true;
}

/** Width of an element, updated when it resizes. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// ------------------------------------------------------------------ tooltip

interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** A tooltip that floats above a point inside a `relative` container. */
function Tip({ tip, width }: { tip: TipState | null; width: number }) {
  if (!tip) return null;
  // Keep the bubble inside the chart horizontally.
  const left = Math.max(60, Math.min(width - 60, tip.x));
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
      style={{ left, top: tip.y - 8 }}
    >
      {tip.content}
    </div>
  );
}

// --------------------------------------------------------------------- ring

export interface RingSegment {
  key: string;
  value: number;
  tone: ChartTone;
  label: string;
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * A ring split into segments, drawn clockwise from the top with a small gap
 * between segments. Each segment draws itself in once, one after another.
 */
export function Ring({
  segments,
  size = 148,
  thickness = 12,
  label,
  children,
}: {
  segments: RingSegment[];
  size?: number;
  thickness?: number;
  label: string;
  children?: ReactNode;
}) {
  const calm = useCalm();
  const r = (size - thickness) / 2;
  const c = size / 2;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const visible = segments.filter((s) => s.value > 0);
  const gap = visible.length > 1 ? 3 / r : 0;
  const starts = visible.map((_, i) =>
    visible.slice(0, i).reduce((sum, x) => sum + (x.value / total) * Math.PI * 2, 0),
  );
  const arcs = visible.map((s, i) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const a0 = (starts[i] ?? 0) + gap / 2;
    const a1 = (starts[i] ?? 0) + sweep - gap / 2;
    // A full single segment needs two arcs; a tiny inset keeps it one path.
    const d = visible.length === 1 ? arcPath(c, c, r, 0, Math.PI * 2 - 0.0001) : arcPath(c, c, r, a0, a1);
    return { ...s, d, i };
  });
  return (
    <div className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />
        {arcs.map((a) => (
          <motion.path
            key={a.key}
            d={a.d}
            fill="none"
            stroke={toneColor(a.tone)}
            strokeWidth={thickness}
            initial={calm ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.5, delay: 0.08 + a.i * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <title>{a.label}</title>
          </motion.path>
        ))}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

// -------------------------------------------------------------------- gauge

/** A half-circle meter for one value against a limit. */
export function Gauge({
  value,
  max,
  tone = 'accent',
  label,
  size = 168,
  children,
}: {
  value: number;
  max: number;
  tone?: ChartTone;
  label: string;
  size?: number;
  children?: ReactNode;
}) {
  const calm = useCalm();
  const thickness = 12;
  const r = (size - thickness) / 2;
  const c = size / 2;
  const h = c + thickness / 2;
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const d = arcPath(c, c, r, -Math.PI / 2, Math.PI / 2);
  return (
    <div className="relative inline-block shrink-0" style={{ width: size, height: h }}>
      <svg
        width={size}
        height={h}
        viewBox={`0 0 ${size} ${h}`}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <path d={d} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} strokeLinecap="round" />
        {share > 0 ? (
          <motion.path
            d={d}
            fill="none"
            stroke={toneColor(tone)}
            strokeWidth={thickness}
            strokeLinecap="round"
            initial={calm ? false : { pathLength: 0 }}
            animate={{ pathLength: share }}
            transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
          />
        ) : null}
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center text-center">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- sparkline

/**
 * A small area chart for a recent trend. The last point is marked; hovering
 * shows each point's value.
 */
export function Sparkline({
  values,
  height = 40,
  label,
  format = (n) => String(n),
  pointLabel,
}: {
  values: number[];
  height?: number;
  label: string;
  format?: (n: number) => string;
  pointLabel?: (index: number) => string;
}) {
  const calm = useCalm();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pad = 5;
  const n = values.length;
  const max = Math.max(1, ...values);
  const x = (i: number) => (n <= 1 ? width - pad : pad + (i / (n - 1)) * (width - pad * 2));
  const y = (v: number) => pad + (1 - v / max) * (height - pad * 2);
  const line = values.map((v, i) => `${i ? 'L' : 'M'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = n > 1 ? `${line} L ${x(n - 1).toFixed(1)} ${height} L ${x(0).toFixed(1)} ${height} Z` : '';
  const last = values[n - 1];
  const hi = hover ?? n - 1;
  return (
    <div
      ref={ref}
      className="relative w-full"
      style={{ height }}
      onPointerLeave={() => setHover(null)}
      onPointerMove={(e) => {
        if (n < 2 || width === 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const i = Math.round(((e.clientX - rect.left - pad) / (width - pad * 2)) * (n - 1));
        setHover(Math.max(0, Math.min(n - 1, i)));
      }}
    >
      {width > 0 && n > 0 ? (
        <svg width={width} height={height} role="img" aria-label={label} className="overflow-visible">
          {area ? <path d={area} fill="var(--accent)" fillOpacity={0.1} /> : null}
          {n > 1 ? (
            <motion.path
              d={line}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={calm ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
            />
          ) : null}
          {hover !== null ? (
            <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke="var(--border)" strokeWidth={1} />
          ) : null}
          {last !== undefined ? (
            <circle
              cx={x(hi)}
              cy={y(values[hi] ?? 0)}
              r={4}
              fill="var(--accent)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          ) : null}
        </svg>
      ) : null}
      {hover !== null && values[hover] !== undefined ? (
        <Tip
          width={width}
          tip={{
            x: x(hover),
            y: y(values[hover]),
            content: (
              <>
                <span className="font-semibold tabular-nums">{format(values[hover])}</span>
                {pointLabel ? <span className="ml-1.5 text-muted">{pointLabel(hover)}</span> : null}
              </>
            ),
          }}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ columns

export interface ColumnDatum {
  key: string;
  /** Short label under the axis; only first, middle and last are shown. */
  label: string;
  /** Stacked from the bottom in this order. */
  parts: Array<{ tone: ChartTone; value: number; label: string }>;
}

/**
 * Columns over time, optionally stacked. Columns grow from the baseline one
 * after another; hovering or focusing a column shows its values.
 */
export function Columns({
  data,
  height = 120,
  label,
  emptyLabel,
  legend = false,
}: {
  data: ColumnDatum[];
  height?: number;
  label: string;
  emptyLabel?: string;
  /** Lists each series with its total below the chart (for two or more series). */
  legend?: boolean;
}) {
  const chart = <ColumnsChart data={data} height={height} label={label} emptyLabel={emptyLabel} />;
  if (!legend) return chart;
  const series = (data[0]?.parts ?? []).map((p, j) => ({
    ...p,
    total: data.reduce((sum, d) => sum + (d.parts[j]?.value ?? 0), 0),
  }));
  return (
    <div className="flex flex-col gap-2">
      {chart}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((s) => (
          <li key={s.label} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-sm ${BG_TONE[s.tone]}`} aria-hidden />
            {s.label}
            <span className="text-text tabular-nums">{s.total}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ColumnsChart({
  data,
  height,
  label,
  emptyLabel,
}: {
  data: ColumnDatum[];
  height: number;
  label: string;
  emptyLabel?: string;
}) {
  const calm = useCalm();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => d.parts.reduce((s, p) => s + p.value, 0));
  const max = Math.max(1, ...totals);
  const n = data.length;
  const axis = 18;
  const top = 14;
  const plot = height - axis - top;
  const band = n ? width / n : 0;
  const bar = Math.max(2, Math.min(24, band - 3));
  const empty = totals.every((t) => t === 0);
  const ticks = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : data.map((_, i) => i);
  return (
    <div ref={ref} className="relative w-full" style={{ height }} onPointerLeave={() => setHover(null)}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={label}>
          <text x={0} y={10} fontSize={10} fill="var(--muted)">
            {max}
          </text>
          <line x1={0} x2={width} y1={top} y2={top} stroke="var(--surface-2)" strokeWidth={1} />
          <line
            x1={0}
            x2={width}
            y1={top + plot + 0.5}
            y2={top + plot + 0.5}
            stroke="var(--border)"
            strokeWidth={1}
          />
          {data.map((d, i) => {
            const cx = band * i + band / 2;
            let y = top + plot;
            const parts = d.parts.filter((p) => p.value > 0);
            return (
              <g
                key={d.key}
                tabIndex={0}
                role="img"
                aria-label={`${d.label}: ${parts.map((p) => `${p.value} ${p.label}`).join(', ') || 0}`}
                onPointerEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="outline-none"
              >
                <rect x={band * i} y={top} width={band} height={plot} fill="transparent" />
                {hover === i ? (
                  <rect
                    x={cx - bar / 2 - 3}
                    y={top}
                    width={bar + 6}
                    height={plot}
                    rx={6}
                    fill="var(--surface-2)"
                  />
                ) : null}
                <motion.g
                  style={{ originY: 1, transformBox: 'fill-box' }}
                  initial={calm ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26, delay: 0.1 + i * 0.015 }}
                >
                  {parts.map((p, j) => {
                    const h = Math.max(1, (p.value / max) * plot);
                    y -= h;
                    const isTop = j === parts.length - 1;
                    const gap = j > 0 ? 2 : 0;
                    return (
                      <path
                        key={j}
                        d={roundedTop(cx - bar / 2, y, bar, h - gap, isTop ? Math.min(4, bar / 2, h / 2) : 0)}
                        fill={toneColor(p.tone)}
                      />
                    );
                  })}
                </motion.g>
              </g>
            );
          })}
          {ticks.map((i) => {
            const d = data[i];
            if (!d) return null;
            const anchor = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
            const tx = i === 0 ? 0 : i === n - 1 ? width : band * i + band / 2;
            return (
              <text key={d.key} x={tx} y={height - 4} fontSize={10} textAnchor={anchor} fill="var(--muted)">
                {d.label}
              </text>
            );
          })}
        </svg>
      ) : null}
      {empty && emptyLabel ? (
        <p className="absolute inset-x-0 top-1/3 text-center text-sm text-muted">{emptyLabel}</p>
      ) : null}
      {hover !== null && data[hover] ? (
        <Tip
          width={width}
          tip={{
            x: band * hover + band / 2,
            y: top + plot - ((totals[hover] ?? 0) / max) * plot,
            content: (
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{data[hover].label}</span>
                {data[hover].parts.map((p) => (
                  <span key={p.label} className="flex items-center gap-1.5">
                    <span className={`size-2 rounded-full ${BG_TONE[p.tone]}`} aria-hidden />
                    <span className="tabular-nums">{p.value}</span>
                    <span className="text-muted">{p.label}</span>
                  </span>
                ))}
              </span>
            ),
          }}
        />
      ) : null}
    </div>
  );
}

/** A rectangle with rounded top corners only, square at the baseline. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const rr = Math.min(r, h);
  return `M ${x} ${y + h} V ${y + rr} Q ${x} ${y} ${x + rr} ${y} H ${x + w - rr} Q ${x + w} ${y} ${x + w} ${y + rr} V ${y + h} Z`;
}

// ------------------------------------------------------------ segment bar

export interface Segment {
  key: string;
  label: string;
  value: number;
  tone: ChartTone;
  /** Opacity for steps of one hue (sequential), 0-1. */
  shade?: number;
}

/**
 * One whole split into parts. `tall` prints each part's share on it where it
 * fits and shows a legend below; the thin bar leaves the numbers to the text
 * around it.
 */
export function SegmentBar({
  segments,
  label,
  tall = false,
  legend = tall,
  format = (n) => String(n),
}: {
  segments: Segment[];
  label: string;
  tall?: boolean;
  legend?: boolean;
  format?: (n: number) => string;
}) {
  const calm = useCalm();
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const parts = segments.filter((s) => s.value > 0);
  const summary = parts.map((s) => `${s.label} ${format(s.value)}`).join(', ');
  return (
    <div className="flex flex-col gap-2">
      <div
        className={`flex w-full gap-0.5 overflow-hidden ${tall ? 'h-7 rounded-md' : 'h-2 rounded-full'} bg-surface-2`}
        role="img"
        aria-label={`${label}: ${summary}`}
      >
        {total > 0
          ? parts.map((s, i) => {
              const share = s.value / total;
              return (
                <motion.div
                  key={s.key}
                  title={`${s.label}: ${format(s.value)} (${Math.round(share * 100)} %)`}
                  className={`flex h-full min-w-1 items-center overflow-hidden ${tall ? 'rounded-[4px] px-2' : ''}`}
                  style={{ flexGrow: share, flexBasis: 0, background: tint(s.tone, (s.shade ?? 1) * 100) }}
                  initial={calm ? false : { scaleX: 0, originX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.45, delay: 0.05 + i * 0.05, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  {tall && share >= 0.1 ? (
                    <span
                      className={`text-xs font-semibold tabular-nums ${(s.shade ?? 1) < 0.55 ? 'text-text' : 'text-accent-contrast'}`}
                    >
                      {Math.round(share * 100)} %
                    </span>
                  ) : null}
                </motion.div>
              );
            })
          : null}
      </div>
      {legend ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {parts.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                className="size-2.5 rounded-sm"
                style={{ background: tint(s.tone, (s.shade ?? 1) * 100) }}
                aria-hidden
              />
              {s.label}
              <span className="text-text tabular-nums">{format(s.value)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ heatmap

/** Opacity steps for the sequential accent scale, light to dark. */
const STEPS = [0.12, 0.3, 0.5, 0.72, 1];

/**
 * A grid of counts (rows × columns), darker for more. Each cell names its
 * value on hover and focus.
 */
export function Heatmap({
  rows,
  columns,
  values,
  label,
  cellLabel,
  columnTicks,
  less,
  more,
}: {
  rows: string[];
  columns: number;
  values: number[][];
  label: string;
  cellLabel: (row: number, col: number, value: number) => string;
  columnTicks: Array<[number, string]>;
  less: string;
  more: string;
}) {
  const calm = useCalm();
  const max = Math.max(0, ...values.flat());
  const step = (v: number) =>
    v <= 0 || max === 0 ? -1 : Math.min(STEPS.length - 1, Math.floor((v / max) * STEPS.length - 1e-9));
  return (
    <div className="flex flex-col gap-2" role="img" aria-label={label}>
      <div
        className="grid items-center gap-[3px]"
        style={{ gridTemplateColumns: `2.25rem repeat(${columns}, minmax(0, 1fr))` }}
      >
        {rows.map((name, r) => (
          <div key={name} className="contents">
            <span className="text-xs text-muted">{name}</span>
            {Array.from({ length: columns }, (_, c) => {
              const v = values[r]?.[c] ?? 0;
              const s = step(v);
              return (
                <motion.span
                  key={c}
                  title={cellLabel(r, c, v)}
                  className={`aspect-square rounded-[3px] ${s < 0 ? 'bg-surface-2' : ''}`}
                  style={s < 0 ? undefined : { background: tint('accent', (STEPS[s] ?? 1) * 100) }}
                  initial={calm ? false : { scale: 0.4 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 24, delay: (r + c) * 0.006 }}
                />
              );
            })}
          </div>
        ))}
        <span />
        <div className="relative col-span-full col-start-2 h-4">
          {columnTicks.map(([c, text]) => (
            <span
              key={c}
              className="absolute text-[10px] text-muted"
              style={{ left: `${(c / columns) * 100}%` }}
            >
              {text}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1.5 text-[10px] text-muted" aria-hidden>
        {less}
        {STEPS.map((o) => (
          <span key={o} className="size-2.5 rounded-[3px]" style={{ background: tint('accent', o * 100) }} />
        ))}
        {more}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- small pieces

/** A dot that pulses softly while something is live. */
export function LiveDot({ tone = 'ok', label }: { tone?: ChartTone; label: string }) {
  return (
    <span className="relative inline-flex size-2.5 shrink-0" role="img" aria-label={label}>
      <span className={`live-pulse absolute inset-0 rounded-full ${BG_TONE[tone]}`} aria-hidden />
      <span className={`relative size-2.5 rounded-full ${BG_TONE[tone]}`} aria-hidden />
    </span>
  );
}

/** A small ring for a share, e.g. the progress of a download. */
export function ProgressRing({
  value,
  size = 36,
  stroke = 4,
  tone = 'accent',
  label,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: ChartTone;
  label: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const share = Math.max(0, Math.min(1, value));
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={toneColor(tone)}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - share) }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[10px] font-semibold tabular-nums">
        {children}
      </span>
    </span>
  );
}

/** A horizontal bar for one value against the largest in a list. */
export function BarRow({
  label,
  value,
  max,
  display,
  tone = 'accent',
  delay = 0,
}: {
  label: ReactNode;
  value: number;
  max: number;
  display: ReactNode;
  tone?: ChartTone;
  delay?: number;
}) {
  const calm = useCalm();
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">{label}</span>
        <span className="text-xs text-muted tabular-nums">{display}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-surface-2">
        <motion.div
          className={`h-full rounded-full ${BG_TONE[tone]}`}
          style={{ width: `${share * 100}%`, originX: 0 }}
          initial={calm ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.5, delay, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </div>
    </div>
  );
}
