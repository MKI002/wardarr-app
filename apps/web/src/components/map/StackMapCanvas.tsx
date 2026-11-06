// Draws the stack map: nodes as logo circles with a status ring, edges as
// smooth curves. Downloads in progress run along their edge as small dots.
// All colours come from the theme tokens, so light and dark both work.
import { motion, useReducedMotionConfig } from 'motion/react';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes, formatSpeed } from '../../lib/format';
import { logoUrl, needsPlate } from '../ServiceLogo';
import { spring } from '../ui';
import { LABEL_H, NODE_R, type MapLayout, type PlacedEdge, type PlacedNode } from './layout';
import type { MapEdge, MapNode, MapTone } from './types';

export const TONE_VAR: Record<MapTone, string> = {
  ok: 'var(--ok)',
  // Marks use the brighter warning step where the theme defines one.
  warning: 'var(--warning-mark, var(--warning))',
  critical: 'var(--critical)',
  unknown: 'var(--muted)',
  off: 'var(--border)',
};

const GLYPH: Partial<Record<MapTone, string>> = { warning: '!', critical: '×', off: '–' };

type T = (key: string, params?: Record<string, unknown>) => string;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** The short second line under a node: what it is doing right now. */
export function nodeSubline(t: T, n: MapNode): string {
  if (n.type === 'ghost') return t('ui.map.ghost');
  if (n.type === 'storage') {
    const s = n.storage!;
    if (s.freeBytes === null) return t('ui.map.storage.noSpace');
    return t('ui.map.storage.free', { free: formatBytes(s.freeBytes) });
  }
  if (n.instanceStatus === 'disabled') return t('ui.map.status.off');
  if (n.instanceStatus === 'down') return t('ui.map.status.critical');
  const l = n.live;
  if (l.streams) return t('ui.map.live.streams', { count: l.streams });
  if (l.downloading)
    return `${t('ui.map.live.downloading', { count: l.downloading })} · ${formatSpeed(l.speed)}`;
  if (l.indexers !== undefined && (n.adapter === 'prowlarr' || l.indexers > 0))
    return l.failingIndexers
      ? t('ui.map.live.indexersFailing', { count: l.indexers, failing: l.failingIndexers })
      : t('ui.map.live.indexers', { count: l.indexers });
  if (l.queue) return t('ui.map.live.queue', { count: l.queue });
  return n.version ? `v${n.version.replace(/^v/i, '')}` : '';
}

export function nodeLabel(t: T, n: MapNode): string {
  const status = n.type === 'ghost' ? t('ui.map.ghost') : t(`ui.map.status.${n.status}`);
  return `${n.name}, ${status}, ${nodeSubline(t, n)}`;
}

/** A lighter step of a colour, mixed with the card surface instead of using opacity. */
export function tint(color: string, percent: number): string {
  return percent >= 100 ? color : `color-mix(in oklab, ${color} ${percent}%, var(--surface))`;
}

/** Logo, disk icon or initial in the middle of a node. */
function NodeGlyph({ node, dim }: { node: MapNode; dim: boolean }) {
  if (node.type === 'storage')
    return (
      <g
        className="map-ink"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <ellipse cx={0} cy={-7} rx={11} ry={4} />
        <path d="M-11-7v14c0 2.2 4.9 4 11 4s11-1.8 11-4V-7" />
        <path d="M-11 0c0 2.2 4.9 4 11 4s11-1.8 11-4" />
      </g>
    );
  const url = logoUrl(node.adapter);
  if (url)
    return (
      <image
        href={url}
        x={-15}
        y={-15}
        width={30}
        height={30}
        style={{
          filter: node.type === 'ghost' || dim ? 'grayscale(1)' : undefined,
          transition: 'filter 150ms',
        }}
        preserveAspectRatio="xMidYMid meet"
      />
    );
  return (
    <text
      textAnchor="middle"
      dominantBaseline="central"
      className="fill-muted"
      style={{ fontSize: 16, fontWeight: 600 }}
    >
      {(node.name.trim().charAt(0) || '?').toUpperCase()}
    </text>
  );
}

function StorageMeter({ node }: { node: MapNode }) {
  const s = node.storage!;
  const r = NODE_R + 3;
  const c = 2 * Math.PI * r;
  const used = s.totalBytes && s.freeBytes !== null ? 1 - s.freeBytes / s.totalBytes : null;
  const color = node.status === 'ok' ? 'var(--accent)' : TONE_VAR[node.status];
  return (
    <g transform="rotate(-90)">
      <circle r={r} fill="none" stroke="var(--surface-2)" strokeWidth={5} />
      {used !== null ? (
        <motion.circle
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.max(0.02, Math.min(1, used))) }}
          transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1], delay: 0.25 }}
        />
      ) : null}
    </g>
  );
}

function Node({
  p,
  t,
  dim,
  selected,
  calm,
  order,
  compact,
  onSelect,
  onHover,
}: {
  p: PlacedNode;
  t: T;
  dim: boolean;
  selected: boolean;
  calm: boolean;
  order: number;
  compact: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const n = p.node;
  const tone = n.status;
  const busy = !!(n.live.streams || n.live.downloading);
  const glyph = n.type === 'ghost' ? undefined : GLYPH[tone];
  const keyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(n.id);
    }
  };
  return (
    <motion.g
      initial={calm ? false : { x: p.x, y: p.y, scale: 0.4, opacity: 0 }}
      animate={{ x: p.x, y: p.y, scale: 1, opacity: 1 }}
      transition={{ ...spring, delay: calm ? 0 : 0.05 * p.column + 0.025 * order }}
      className="map-node cursor-pointer outline-none"
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={nodeLabel(t, n)}
      onClick={() => onSelect(n.id)}
      onKeyDown={keyDown}
      onMouseEnter={() => onHover(n.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(n.id)}
      onBlur={() => onHover(null)}
      data-node={n.id}
    >
      {/* Generous hit area, including the labels. */}
      <rect x={-62} y={-NODE_R - 10} width={124} height={NODE_R * 2 + LABEL_H + 14} fill="transparent" />
      <circle r={NODE_R + 9} className="map-focus" fill="none" stroke="var(--accent)" strokeWidth={2} />
      {busy && !calm ? (
        <circle r={NODE_R} className="map-pulse" fill="none" stroke="var(--accent)" strokeWidth={2} />
      ) : null}
      {selected ? (
        <motion.circle
          r={NODE_R + 9}
          fill={tint('var(--accent)', 16)}
          initial={calm ? false : { scale: 0.6 }}
          animate={{ scale: 1 }}
          transition={spring}
        />
      ) : null}
      <circle
        r={NODE_R}
        className={needsPlate(n.adapter) ? 'fill-[#24292e] dark:fill-surface' : 'fill-surface'}
        stroke="var(--border)"
        strokeWidth={1}
      />
      {n.type === 'storage' ? (
        <StorageMeter node={n} />
      ) : (
        <circle
          r={NODE_R + 3}
          fill="none"
          stroke={n.type === 'ghost' ? tint('var(--muted)', 70) : tint(TONE_VAR[tone], dim ? 45 : 100)}
          strokeWidth={n.type === 'ghost' ? 1.5 : 2.5}
          strokeDasharray={n.type === 'ghost' || tone === 'off' ? '4 4' : undefined}
          style={{ transition: 'stroke 150ms' }}
        />
      )}
      <NodeGlyph node={n} dim={dim} />
      {glyph ? (
        <g transform={`translate(${NODE_R * 0.74},${NODE_R * 0.74})`} aria-hidden>
          <circle r={8.5} fill={TONE_VAR[tone]} stroke="var(--surface)" strokeWidth={2} />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--bg)"
            style={{ fontSize: 12, fontWeight: 700 }}
          >
            {glyph}
          </text>
        </g>
      ) : null}
      <text
        y={NODE_R + 17}
        textAnchor="middle"
        className={dim ? 'fill-muted' : 'fill-text'}
        style={{ fontSize: 12.5, fontWeight: 600, transition: 'fill 150ms' }}
      >
        {truncate(n.name || t('ui.map.storage.name'), compact ? 15 : 20)}
      </text>
      <text y={NODE_R + 32} textAnchor="middle" className="fill-muted" style={{ fontSize: 11 }}>
        {truncate(nodeSubline(t, n), compact ? 17 : 26)}
      </text>
    </motion.g>
  );
}

function edgeStroke(e: MapEdge): string {
  if (e.status === 'critical') return 'var(--critical)';
  if (e.status === 'warning') return TONE_VAR.warning;
  if (e.active) return 'var(--accent)';
  return 'var(--muted)';
}

function edgeDash(e: MapEdge): string | undefined {
  if (!e.enabled || e.status === 'off' || e.status === 'unknown') return '5 5';
  if (!e.confident) return '1 5';
  return undefined;
}

function Edge({
  pe,
  dim,
  lit,
  calm,
  delay,
  onHover,
}: {
  pe: PlacedEdge;
  dim: boolean;
  lit: boolean;
  calm: boolean;
  delay: number;
  onHover: (edge: PlacedEdge | null) => void;
}) {
  const e = pe.edge;
  const dash = edgeDash(e);
  const stroke = edgeStroke(e);
  const strength = dim
    ? 14
    : lit
      ? 100
      : e.active || e.status === 'critical' || e.status === 'warning'
        ? 80
        : 42;
  return (
    <g>
      <motion.path
        d={pe.d}
        fill="none"
        stroke={tint(stroke, strength)}
        strokeWidth={lit ? 2.25 : 1.75}
        strokeLinecap="round"
        strokeDasharray={dash}
        style={{ transition: 'stroke 150ms, stroke-width 150ms' }}
        initial={calm ? false : dash ? { opacity: 0 } : { pathLength: 0 }}
        animate={dash ? { opacity: 1 } : { pathLength: 1 }}
        transition={{
          pathLength: { duration: 0.55, ease: [0.3, 0.7, 0.2, 1], delay },
          opacity: { duration: 0.3, delay },
        }}
      />
      {e.active && !calm ? (
        <g aria-hidden>
          {[0, 1, 2].map((k) => (
            <circle key={k} r={2.6} fill={tint('var(--accent)', dim ? 20 : 100)}>
              <animateMotion dur="2.4s" begin={`${-k * 0.8}s`} repeatCount="indefinite" path={pe.d} />
            </circle>
          ))}
        </g>
      ) : null}
      {/* Wider invisible stroke for hovering. */}
      <path
        d={pe.d}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        onMouseEnter={() => onHover(pe)}
        onMouseLeave={() => onHover(null)}
      />
    </g>
  );
}

function Chip({ pe }: { pe: PlacedEdge }) {
  const text = `↓ ${pe.edge.active}`;
  const w = 12 + text.length * 6.5;
  return (
    <motion.g
      initial={{ scale: 0, x: pe.mid.x, y: pe.mid.y }}
      animate={{ scale: 1, x: pe.mid.x, y: pe.mid.y }}
      transition={{ ...spring, delay: 0.5 }}
      aria-hidden
      pointerEvents="none"
    >
      <rect
        x={-w / 2}
        y={-9}
        width={w}
        height={18}
        rx={9}
        fill="var(--surface)"
        stroke="var(--accent)"
        strokeWidth={1.25}
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fill="var(--accent)"
        style={{ fontSize: 11, fontWeight: 600 }}
      >
        {text}
      </text>
    </motion.g>
  );
}

export function StackMapCanvas({
  layout,
  scale,
  selected,
  onSelect,
}: {
  layout: MapLayout;
  scale: number;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const calm = useReducedMotionConfig() === true;
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<PlacedEdge | null>(null);
  const focus = hoverNode ?? selected;

  const lit = useMemo(() => {
    if (!focus) return null;
    const nodes = new Set([focus]);
    const edges = new Set<string>();
    for (const pe of layout.edges)
      if (pe.edge.from === focus || pe.edge.to === focus) {
        edges.add(pe.edge.id);
        nodes.add(pe.edge.from);
        nodes.add(pe.edge.to);
      }
    return { nodes, edges };
  }, [focus, layout.edges]);

  const names = useMemo(() => new Map(layout.nodes.map((p) => [p.node.id, p.node.name])), [layout.nodes]);
  const orderInColumn = useMemo(() => {
    const seen = new Map<number, number>();
    return new Map(
      [...layout.nodes]
        .sort((a, b) => a.column - b.column || a.y - b.y || a.x - b.x)
        .map((p) => {
          const k = seen.get(p.column) ?? 0;
          seen.set(p.column, k + 1);
          return [p.node.id, k];
        }),
    );
  }, [layout.nodes]);
  const lastColumn = Math.max(0, ...layout.nodes.map((p) => p.column));

  return (
    <div className="relative" style={{ width: layout.width * scale, height: layout.height * scale }}>
      <svg
        width={layout.width * scale}
        height={layout.height * scale}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="group"
        aria-label={t('ui.map.canvasLabel')}
        className="block overflow-visible select-none"
      >
        <g>
          {layout.edges.map((pe) => (
            <Edge
              key={pe.edge.id}
              pe={pe}
              dim={!!lit && !lit.edges.has(pe.edge.id)}
              lit={!!lit && lit.edges.has(pe.edge.id)}
              calm={calm}
              delay={0.12 + 0.05 * lastColumn}
              onHover={setHoverEdge}
            />
          ))}
        </g>
        <g>
          {layout.edges
            .filter((pe) => pe.edge.active)
            .map((pe) => (
              <Chip key={pe.edge.id} pe={pe} />
            ))}
        </g>
        <g>
          {layout.nodes.map((p) => (
            <Node
              key={p.node.id}
              p={p}
              t={t}
              dim={!!lit && !lit.nodes.has(p.node.id)}
              selected={selected === p.node.id}
              calm={calm}
              order={orderInColumn.get(p.node.id) ?? 0}
              compact={layout.orientation === 'vertical'}
              onSelect={onSelect}
              onHover={setHoverNode}
            />
          ))}
        </g>
      </svg>
      {hoverEdge ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 w-max max-w-64 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg"
          style={{ left: hoverEdge.mid.x * scale, top: hoverEdge.mid.y * scale }}
        >
          <p className="font-semibold">
            {names.get(hoverEdge.edge.from)} → {names.get(hoverEdge.edge.to)}
          </p>
          <p className="text-muted">{edgeText(t, hoverEdge.edge)}</p>
        </div>
      ) : null}
    </div>
  );
}

/** One line describing what an edge carries. */
export function edgeText(t: T, e: MapEdge): string {
  const parts: string[] = [];
  const kind = e.kind === 'storage' ? `storage.${e.use ?? 'media'}` : e.kind;
  parts.push(t(`ui.map.kind.${kind}`));
  if (e.kind === 'indexers' && e.indexerIds)
    parts.push(t('ui.map.live.indexers', { count: e.indexerIds.length }));
  if (e.failing) parts.push(t('ui.map.edge.failing', { count: e.failing }));
  if (e.active) parts.push(t('ui.map.live.downloading', { count: e.active }));
  if (e.is4k) parts.push('4K');
  if (!e.enabled) parts.push(t('ui.map.edge.disabled'));
  if (!e.confident) parts.push(t('ui.map.edge.inferred'));
  return parts.join(' · ');
}
