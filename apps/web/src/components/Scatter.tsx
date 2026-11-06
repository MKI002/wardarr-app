// A bubble scatter: two measures per item, a third as bubble size. Used to
// place indexers by speed and reliability. The x axis can be logarithmic,
// because answer times span from a few hundred milliseconds to seconds.
import { motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { tint, toneColor, useCalm, useWidth, type ChartTone } from './charts';

export interface ScatterPoint {
  key: string;
  name: string;
  x: number;
  y: number;
  /** Bubble size; the area grows with it. */
  size: number;
  tone?: ChartTone;
  tooltip: ReactNode;
}

export function Scatter({
  points,
  label,
  height = 300,
  xLog = false,
  xDomain,
  yDomain,
  xTicks,
  yTicks,
  xTitle,
  yTitle,
  corners,
  labelTop = 4,
  onSelect,
}: {
  points: ScatterPoint[];
  label: string;
  height?: number;
  xLog?: boolean;
  xDomain: [number, number];
  yDomain: [number, number];
  xTicks: Array<[number, string]>;
  yTicks: Array<[number, string]>;
  xTitle: string;
  yTitle: string;
  /** Muted notes in the best (top left) and worst (bottom right) corner. */
  corners?: { best: string; worst: string };
  /** How many of the biggest bubbles get their name printed. */
  labelTop?: number;
  onSelect?: (key: string) => void;
}) {
  const calm = useCalm();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);
  const m = { left: 44, right: 14, top: 24, bottom: 34 };
  const w = Math.max(0, width - m.left - m.right);
  const h = height - m.top - m.bottom;
  const fx = (v: number) => (xLog ? Math.log10(Math.max(v, 1)) : v);
  const [x0, x1] = [fx(xDomain[0]), fx(xDomain[1])];
  const sx = (v: number) => m.left + ((Math.min(Math.max(fx(v), x0), x1) - x0) / (x1 - x0 || 1)) * w;
  const sy = (v: number) =>
    m.top +
    (1 - (Math.min(Math.max(v, yDomain[0]), yDomain[1]) - yDomain[0]) / (yDomain[1] - yDomain[0] || 1)) * h;
  const maxSize = Math.max(1, ...points.map((p) => p.size));
  const radius = (s: number) => 6 + Math.sqrt(Math.max(0, s) / maxSize) * 16;
  // Draw big bubbles first so small ones stay on top and clickable.
  const ordered = [...points].sort((a, b) => b.size - a.size);
  const labels = placeLabels(ordered.slice(0, labelTop), points, sx, sy, radius, m.left + w);
  const active = points.find((p) => p.key === hover) ?? null;

  return (
    <div ref={ref} className="relative w-full" style={{ height }} onPointerLeave={() => setHover(null)}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={label} className="overflow-visible">
          {corners ? (
            <>
              <text x={m.left + 8} y={m.top + 14} fontSize={11} fill="var(--muted)">
                {corners.best}
              </text>
              <text x={m.left + w - 8} y={m.top + h - 8} fontSize={11} fill="var(--muted)" textAnchor="end">
                {corners.worst}
              </text>
            </>
          ) : null}
          {yTicks.map(([v, text]) => (
            <g key={`y${v}`}>
              <line
                x1={m.left}
                x2={m.left + w}
                y1={sy(v)}
                y2={sy(v)}
                stroke="var(--surface-2)"
                strokeWidth={1}
              />
              <text x={m.left - 6} y={sy(v) + 3} fontSize={10} textAnchor="end" fill="var(--muted)">
                {text}
              </text>
            </g>
          ))}
          {xTicks.map(([v, text]) => (
            <g key={`x${v}`}>
              <line
                x1={sx(v)}
                x2={sx(v)}
                y1={m.top}
                y2={m.top + h}
                stroke="var(--surface-2)"
                strokeWidth={1}
              />
              <text x={sx(v)} y={m.top + h + 14} fontSize={10} textAnchor="middle" fill="var(--muted)">
                {text}
              </text>
            </g>
          ))}
          <line
            x1={m.left}
            x2={m.left + w}
            y1={m.top + h + 0.5}
            y2={m.top + h + 0.5}
            stroke="var(--border)"
            strokeWidth={1}
          />
          <text x={m.left + w} y={height - 2} fontSize={10} textAnchor="end" fill="var(--muted)">
            {xTitle} →
          </text>
          <text x={4} y={10} fontSize={10} fill="var(--muted)">
            ↑ {yTitle}
          </text>
          {ordered.map((p, i) => {
            const cx = sx(p.x);
            const cy = sy(p.y);
            const r = radius(p.size);
            const on = hover === p.key;
            const tone = p.tone ?? 'accent';
            return (
              <g
                key={p.key}
                tabIndex={0}
                role={onSelect ? 'button' : 'img'}
                aria-label={p.name}
                className="cursor-pointer outline-none"
                onPointerEnter={() => setHover(p.key)}
                onFocus={() => setHover(p.key)}
                onBlur={() => setHover(null)}
                onClick={() => onSelect?.(p.key)}
                onKeyDown={(e) => {
                  if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onSelect(p.key);
                  }
                }}
              >
                <motion.circle
                  cx={cx}
                  cy={cy}
                  fill={on ? toneColor(tone) : tint(tone, 62)}
                  stroke="var(--surface)"
                  strokeWidth={2}
                  initial={calm ? false : { r: 0, cy: m.top + h }}
                  animate={{ r: on ? r + 3 : r, cy }}
                  transition={{
                    type: 'spring',
                    stiffness: 220,
                    damping: 18,
                    delay: calm ? 0 : 0.1 + i * 0.05,
                  }}
                />
                {labels.has(p.key) ? (
                  <text
                    {...labelAt(labels.get(p.key)!, cx, cy, r)}
                    fontSize={11}
                    fill="var(--text)"
                    className="pointer-events-none"
                    paintOrder="stroke"
                    stroke="var(--surface)"
                    strokeWidth={3}
                  >
                    {p.name}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : null}
      {active ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
          style={{
            left: Math.max(70, Math.min(width - 70, sx(active.x))),
            top: sy(active.y) - radius(active.size) - 8,
          }}
        >
          {active.tooltip}
        </div>
      ) : null}
    </div>
  );
}

type Side = 'right' | 'left' | 'below' | 'above';
const SIDES: Side[] = ['right', 'left', 'below', 'above'];

function labelAt(side: Side, cx: number, cy: number, r: number) {
  if (side === 'right') return { x: cx + r + 5, y: cy + 4, textAnchor: 'start' as const };
  if (side === 'left') return { x: cx - r - 5, y: cy + 4, textAnchor: 'end' as const };
  if (side === 'below') return { x: cx, y: cy + r + 14, textAnchor: 'middle' as const };
  return { x: cx, y: cy - r - 6, textAnchor: 'middle' as const };
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Names for the biggest bubbles: right of the bubble, else left, below or above. A name
 * that would cover another bubble or name is left out; the tooltip still has it.
 */
function placeLabels(
  wanted: ScatterPoint[],
  all: ScatterPoint[],
  sx: (v: number) => number,
  sy: (v: number) => number,
  radius: (s: number) => number,
  right: number,
) {
  const bubbles = all.map((p) => {
    const r = radius(p.size);
    return { key: p.key, box: { x0: sx(p.x) - r, x1: sx(p.x) + r, y0: sy(p.y) - r, y1: sy(p.y) + r } };
  });
  const taken: Box[] = [];
  const out = new Map<string, Side>();
  for (const p of wanted) {
    const cx = sx(p.x);
    const cy = sy(p.y);
    const r = radius(p.size);
    const width = p.name.length * 6.2;
    for (const side of SIDES) {
      const x0 = side === 'right' ? cx + r + 5 : side === 'left' ? cx - r - 5 - width : cx - width / 2;
      const y0 = side === 'below' ? cy + r + 3 : side === 'above' ? cy - r - 17 : cy - 7;
      const box = { x0, x1: x0 + width, y0, y1: y0 + 14 };
      if (box.x1 > right + 10 || box.x0 < 0 || box.y0 < 0) continue;
      if (taken.some((b) => hits(b, box))) continue;
      if (bubbles.some((b) => b.key !== p.key && hits(b.box, box))) continue;
      out.set(p.key, side);
      taken.push(box);
      break;
    }
  }
  return out;
}
