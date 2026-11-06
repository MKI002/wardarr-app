// The storage page's centrepiece: used space of one disk over time, its
// capacity as the ceiling and the forecast running on from today until the
// disk is full. The range of the forecast is a soft cone around the line.
import { motion } from 'motion/react';
import { useState } from 'react';
import { tint, toneColor, useCalm, useWidth, type ChartTone } from '../charts';

const DAY = 86_400_000;

export interface ForecastInput {
  /** Daily used space, oldest first. */
  history: Array<{ day: string; usedBytes: number }>;
  usedBytes: number;
  totalBytes: number;
  forecast: {
    status: 'collecting' | 'stable' | 'filling' | 'full';
    bytesPerDay: number | null;
    daysLeft: number | null;
    fullAt: string | null;
    earliestAt: string | null;
    latestAt: string | null;
  };
}

interface Labels {
  chart: string;
  today: string;
  capacity: string;
  fullOn: (date: string) => string;
  fullLater: (days: number) => string;
  used: string;
  free: string;
  projected: string;
}

export function ForecastChart({
  input,
  rangeDays,
  tone,
  height = 260,
  now,
  bytes,
  date,
  labels,
}: {
  input: ForecastInput;
  rangeDays: number;
  /** Status tone of the disk; marks the point where it runs full. */
  tone: ChartTone;
  height?: number;
  /** The moment the disk was read; the line ends and the forecast starts here. */
  now: number;
  bytes: (n: number) => string;
  date: (ms: number) => string;
  labels: Labels;
}) {
  const calm = useCalm();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const { forecast, totalBytes, usedBytes } = input;
  const free = Math.max(0, totalBytes - usedBytes);

  // How far the forecast reaches: to the day the disk is full (with some
  // air), at least a week, at most as far as the history looks back.
  const maxAhead = Math.max(30, rangeDays);
  const filling = forecast.status === 'filling' && forecast.daysLeft !== null;
  const ahead = filling
    ? Math.min(maxAhead, Math.max(7, Math.ceil(forecast.daysLeft! * 1.15)))
    : Math.max(7, Math.round(rangeDays * 0.25));
  const start = now - rangeDays * DAY;
  const end = now + ahead * DAY;

  const padL = 4;
  const padR = 4;
  const padT = 22;
  const padB = 26;
  const plotW = Math.max(0, width - padL - padR);
  const plotH = height - padT - padB;
  const x = (ms: number) => padL + ((ms - start) / (end - start)) * plotW;
  const y = (b: number) => padT + (1 - Math.max(0, Math.min(totalBytes, b)) / totalBytes) * plotH;

  const points = [
    ...input.history
      .map((p) => ({ at: Date.parse(`${p.day}T12:00:00Z`), used: p.usedBytes }))
      .filter((p) => p.at >= start && p.at < now - DAY / 4),
    { at: now, used: usedBytes },
  ];
  const line = points
    .map((p, i) => `${i ? 'L' : 'M'} ${x(p.at).toFixed(1)} ${y(p.used).toFixed(1)}`)
    .join(' ');
  const first = points[0]!;
  const area = `${line} L ${x(now).toFixed(1)} ${y(0)} L ${x(first.at).toFixed(1)} ${y(0)} Z`;

  /** Where a straight line from today with `rate` bytes/day meets the ceiling (or the edge). */
  const reach = (rate: number) => {
    if (rate <= 0) return { at: end, used: usedBytes, hits: false };
    const hitAt = now + (free / rate) * DAY;
    if (hitAt <= end) return { at: hitAt, used: totalBytes, hits: true };
    return { at: end, used: usedBytes + rate * ((end - now) / DAY), hits: false };
  };
  const rateUntil = (iso: string | null) => (iso ? free / Math.max(1e-6, (Date.parse(iso) - now) / DAY) : 0);
  const median = reach(forecast.bytesPerDay ?? 0);
  const fast = reach(filling ? rateUntil(forecast.earliestAt) : 0);
  const slow = reach(filling ? rateUntil(forecast.latestAt) : 0);
  const showForecast = forecast.status === 'filling' || forecast.status === 'stable';
  const cone = filling
    ? [
        `M ${x(now)} ${y(usedBytes)}`,
        `L ${x(fast.at)} ${y(fast.used)}`,
        fast.hits ? `L ${x(end)} ${y(totalBytes)}` : '',
        slow.hits ? `L ${x(end)} ${y(totalBytes)}` : `L ${x(end)} ${y(slow.used)}`,
        slow.hits ? `L ${x(slow.at)} ${y(totalBytes)}` : '',
        'Z',
      ].join(' ')
    : '';
  const projection = `M ${x(now)} ${y(usedBytes)} L ${x(median.at)} ${y(median.used)}${
    median.hits ? ` L ${x(end)} ${y(totalBytes)}` : ''
  }`;

  // Hover: history points before today, the median forecast after it.
  const readout = (() => {
    if (hover === null) return null;
    const ms = start + ((hover - padL) / plotW) * (end - start);
    if (ms <= now) {
      const nearest = points.reduce((a, b) => (Math.abs(b.at - ms) < Math.abs(a.at - ms) ? b : a));
      return { at: nearest.at, used: nearest.used, projected: false };
    }
    if (!showForecast) return null;
    const rate = forecast.bytesPerDay ?? 0;
    return {
      at: ms,
      used: Math.min(totalBytes, usedBytes + Math.max(0, rate) * ((ms - now) / DAY)),
      projected: true,
    };
  })();

  const fullX = median.hits ? x(median.at) : null;
  const ticks = [start, now, end];

  return (
    <div
      ref={ref}
      className="relative w-full select-none"
      style={{ height }}
      onPointerLeave={() => setHover(null)}
      onPointerMove={(e) => {
        if (plotW <= 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        setHover(Math.max(padL, Math.min(padL + plotW, e.clientX - rect.left)));
      }}
    >
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={labels.chart} className="overflow-visible">
          {/* Baseline, half and capacity: hairlines one step off the surface. */}
          <line x1={padL} x2={padL + plotW} y1={y(0)} y2={y(0)} stroke="var(--border)" />
          <line
            x1={padL}
            x2={padL + plotW}
            y1={y(totalBytes / 2)}
            y2={y(totalBytes / 2)}
            stroke="var(--border)"
          />
          <rect x={padL} y={padT - 1} width={plotW} height={2} rx={1} fill={tint('neutral', 55)} />
          <text x={padL} y={padT - 8} className="fill-muted text-[11px]">
            {labels.capacity} · {bytes(totalBytes)}
          </text>

          {/* History. */}
          <path d={area} fill={tint('accent', 12)} />
          <motion.path
            d={line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={calm ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
          />

          {/* Forecast: range as a cone, median as a dashed line. */}
          {cone ? (
            <motion.path
              d={cone}
              fill={tint('accent', 16)}
              initial={calm ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.55, ease: 'easeOut' }}
            />
          ) : null}
          {showForecast ? (
            <motion.path
              d={projection}
              fill="none"
              stroke={tint('accent', 70)}
              strokeWidth={2}
              strokeDasharray="5 5"
              strokeLinecap="round"
              initial={calm ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.5, delay: 0.6, ease: 'easeOut' }}
            />
          ) : null}

          {/* Today. */}
          <line x1={x(now)} x2={x(now)} y1={padT} y2={y(0)} stroke="var(--border)" />
          <circle
            cx={x(now)}
            cy={y(usedBytes)}
            r={4}
            fill="var(--accent)"
            stroke="var(--surface)"
            strokeWidth={2}
          />

          {/* The day the disk runs full. */}
          {fullX !== null ? (
            <motion.g
              initial={calm ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 420, damping: 22, delay: 1.0 }}
            >
              <circle
                cx={fullX}
                cy={padT}
                r={5}
                fill={toneColor(tone)}
                stroke="var(--surface)"
                strokeWidth={2}
              />
            </motion.g>
          ) : null}

          {/* Axis: start, today, end. */}
          {ticks.map((ms, i) => (
            <text
              key={ms}
              x={x(ms)}
              y={height - 8}
              textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}
              className={`text-[11px] ${i === 1 ? 'fill-text font-medium' : 'fill-muted'}`}
            >
              {i === 1 ? labels.today : date(ms)}
            </text>
          ))}

          {hover !== null && readout ? (
            <>
              <line
                x1={x(readout.at)}
                x2={x(readout.at)}
                y1={padT}
                y2={y(0)}
                stroke="var(--muted)"
                strokeWidth={1}
              />
              <circle
                cx={x(readout.at)}
                cy={y(readout.used)}
                r={4}
                fill={readout.projected ? 'var(--surface)' : 'var(--accent)'}
                stroke={readout.projected ? tint('accent', 70) : 'var(--surface)'}
                strokeWidth={2}
              />
            </>
          ) : null}
        </svg>
      ) : null}

      {fullX !== null && width > 0 ? (
        <span
          className="pointer-events-none absolute rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium whitespace-nowrap shadow-sm"
          style={{
            top: padT + 8,
            left: Math.min(width - 4, Math.max(4, fullX)),
            transform: fullX > width * 0.75 ? 'translateX(-100%)' : 'translateX(-50%)',
          }}
        >
          {labels.fullOn(date(median.at))}
        </span>
      ) : filling && width > 0 ? (
        <span
          className="pointer-events-none absolute right-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium whitespace-nowrap"
          style={{ top: padT + 8 }}
        >
          {labels.fullLater(Math.round(forecast.daysLeft!))} →
        </span>
      ) : null}

      {hover !== null && readout ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
          style={{ left: Math.max(70, Math.min(width - 70, x(readout.at))), top: y(readout.used) - 10 }}
        >
          <div className="font-semibold tabular-nums">
            {bytes(totalBytes - readout.used)} <span className="font-normal text-muted">{labels.free}</span>
          </div>
          <div className="text-muted tabular-nums">
            {bytes(readout.used)} {labels.used} · {date(readout.at)}
            {readout.projected ? ` · ${labels.projected}` : ''}
          </div>
        </div>
      ) : null}
    </div>
  );
}
