// The watch radar: every connected service is a blip, grouped by category
// around the guardian in the middle. A beam sweeps around once every few
// seconds; blips glow up as it passes, problems with a ring that spreads.
// Drawn on canvas; it pauses off screen and in background tabs and holds
// still when motion is reduced.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCalm, type ChartTone } from './charts';

export interface RadarBlip {
  id: string;
  name: string;
  /** Groups blips into sectors, in the order given by `sectors`. */
  sector: string;
  tone: ChartTone;
  detail: string;
}

const TURN_MS = 6400;
const TAU = Math.PI * 2;

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

/** Hex colour to rgba() with an alpha. */
function alpha(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

/** A small stable number in [0, 1) from a string, so blips keep their place. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

interface Placed extends RadarBlip {
  angle: number;
  radius: number;
}

function place(blips: RadarBlip[], sectors: string[]): Placed[] {
  // Evenly around the circle, grouped by sector so each category sits together.
  const order = [...blips].sort(
    (a, b) => sectors.indexOf(a.sector) - sectors.indexOf(b.sector) || a.name.localeCompare(b.name),
  );
  const n = Math.max(1, order.length);
  return order.map((b, i) => ({
    ...b,
    angle: ((i + 0.5) / n) * TAU,
    // Alternate between two rings so neighbours don't touch.
    radius: 0.52 + (i % 2) * 0.24 + (hash(b.id) - 0.5) * 0.08,
  }));
}

export function Radar({
  blips,
  sectors,
  sectorLabel,
  label,
  size = 240,
}: {
  blips: RadarBlip[];
  sectors: string[];
  sectorLabel: (sector: string) => string;
  label: string;
  size?: number;
}) {
  const calm = useCalm();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<Placed | null>(null);
  const placed = place(blips, sectors);
  const placedRef = useRef(placed);
  useLayoutEffect(() => {
    placedRef.current = placed;
  });
  // Without the animation loop, a change of data or theme needs one redraw.
  const key = placed.map((p) => `${p.id}:${p.tone}`).join('|');

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = size * dpr;
    el.height = size * dpr;
    ctx.scale(dpr, dpr);

    let colors = readColors();
    let raf = 0;
    let visible = true;
    let lastColorRead = 0;
    const start = performance.now();
    const c = size / 2;
    const R = size / 2 - 6;

    function readColors() {
      return {
        accent: cssColor('--accent'),
        border: cssColor('--border'),
        surface: cssColor('--surface'),
        muted: cssColor('--muted'),
        ok: cssColor('--ok'),
        warning: cssColor('--warning-mark'),
        critical: cssColor('--critical'),
        info: cssColor('--info'),
      };
    }
    const toneHex = (tone: ChartTone) =>
      tone === 'neutral' ? colors.muted : colors[tone as keyof typeof colors];

    function draw(now: number) {
      if (!ctx) return;
      if (now - lastColorRead > 1000) {
        colors = readColors();
        lastColorRead = now;
      }
      const sweep = calm ? -Math.PI / 4 : (((now - start) % TURN_MS) / TURN_MS) * TAU;
      ctx.clearRect(0, 0, size, size);

      // Rings and cross.
      ctx.lineWidth = 1;
      ctx.strokeStyle = colors.border;
      for (const f of [0.36, 0.64, 1]) {
        ctx.beginPath();
        ctx.arc(c, c, R * f, 0, TAU);
        ctx.stroke();
      }
      ctx.strokeStyle = alpha(colors.border, 0.55);
      ctx.beginPath();
      ctx.moveTo(c - R, c);
      ctx.lineTo(c + R, c);
      ctx.moveTo(c, c - R);
      ctx.lineTo(c, c + R);
      ctx.stroke();

      // The beam: a fading wedge behind a bright edge.
      const a = sweep - Math.PI / 2;
      const steps = 24;
      for (let i = 0; i < steps; i++) {
        const a0 = a - (i + 1) * 0.045;
        const a1 = a - i * 0.045;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.arc(c, c, R, a0, a1);
        ctx.closePath();
        ctx.fillStyle = alpha(colors.accent, 0.22 * (1 - i / steps) ** 2);
        ctx.fill();
      }
      ctx.strokeStyle = alpha(colors.accent, 0.85);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + R * Math.cos(a), c + R * Math.sin(a));
      ctx.stroke();

      // Blips. "Since" is how far the beam has moved past a blip, 0..1 of a turn.
      for (const b of placedRef.current) {
        const x = c + R * b.radius * Math.sin(b.angle);
        const y = c - R * b.radius * Math.cos(b.angle);
        const since = ((((sweep - b.angle) % TAU) + TAU) % TAU) / TAU;
        const glow = calm ? 0.6 : Math.max(0, 1 - since * 2.2);
        const hex = toneHex(b.tone);
        const problem = b.tone === 'warning' || b.tone === 'critical';
        if (problem && !calm && since < 0.35) {
          const p = since / 0.35;
          ctx.strokeStyle = alpha(hex, 0.7 * (1 - p));
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, 5 + p * 16, 0, TAU);
          ctx.stroke();
        }
        ctx.fillStyle = alpha(hex, 0.18 + glow * 0.3);
        ctx.beginPath();
        ctx.arc(x, y, 7 + glow * 3, 0, TAU);
        ctx.fill();
        ctx.fillStyle = hex;
        ctx.strokeStyle = colors.surface;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }

      // The guardian's eye in the middle.
      ctx.fillStyle = colors.accent;
      ctx.beginPath();
      ctx.arc(c, c, 6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = colors.surface;
      ctx.beginPath();
      ctx.arc(c + 1.4, c - 1.4, 1.8, 0, TAU);
      ctx.fill();

      if (!calm && visible && !document.hidden) raf = requestAnimationFrame(draw);
    }

    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            const was = visible;
            visible = entry?.isIntersecting ?? true;
            if (visible && !was) raf = requestAnimationFrame(draw);
          });
    io?.observe(el);
    const onVisibility = () => {
      if (!document.hidden && visible) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const themeWatch = new MutationObserver(() => {
      lastColorRead = 0;
      if (calm) requestAnimationFrame(draw);
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      themeWatch.disconnect();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [size, calm, key]);

  const R = size / 2 - 6;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <canvas
        ref={canvas}
        style={{ width: size, height: size }}
        aria-hidden
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          let best: Placed | null = null;
          let bestD = 14;
          for (const b of placed) {
            const x = size / 2 + R * b.radius * Math.sin(b.angle);
            const y = size / 2 - R * b.radius * Math.cos(b.angle);
            const d = Math.hypot(px - x, py - y);
            if (d < bestD) {
              best = b;
              bestD = d;
            }
          }
          setHover(best);
        }}
      />
      {hover ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
          style={{
            left: size / 2 + R * hover.radius * Math.sin(hover.angle),
            top: size / 2 - R * hover.radius * Math.cos(hover.angle) - 10,
          }}
        >
          <span className="font-semibold">{hover.name}</span>
          <span className="ml-1.5 text-muted">{hover.detail}</span>
        </div>
      ) : null}
      <ul className="sr-only" aria-label={label}>
        {sectors.map((s) =>
          placed
            .filter((p) => p.sector === s)
            .map((p) => (
              <li key={p.id}>
                {sectorLabel(s)}: {p.name}, {p.detail}
              </li>
            )),
        )}
      </ul>
    </div>
  );
}
