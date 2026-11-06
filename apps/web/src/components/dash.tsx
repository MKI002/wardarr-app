// Layout pieces shared by the dashboards: page header, section rule, rolling
// numbers, key-figure cards and the "worth a look" rows.
import { motion } from 'motion/react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { BG_TONE, tint, toneColor, useCalm, type ChartTone } from './charts';
import { ServiceLogo } from './ServiceLogo';
import { Card, spring } from './ui';

/** Page title with a small eyebrow above it and actions on the right. */
export function PageHeader({
  eyebrow,
  title,
  intro,
  actions,
}: {
  eyebrow?: ReactNode;
  title: string;
  intro?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? (
          <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">{eyebrow}</span>
        ) : null}
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{title}</h1>
        {intro ? <p className="max-w-prose text-sm text-muted">{intro}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A small uppercase label followed by a hairline, between groups of cards. */
export function SectionRule({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="shrink-0 text-xs font-semibold tracking-[0.14em] text-muted uppercase">{children}</h2>
      <span className="h-px flex-1 bg-border" aria-hidden />
      {action}
    </div>
  );
}

/**
 * A number that rolls into place like a mechanical counter. Digits slide,
 * everything else (units, separators) stands still. The first time it shows,
 * every digit rolls up from 0.
 */
export function Odometer({ text, className = '' }: { text: string; className?: string }) {
  const calm = useCalm();
  const [shown, setShown] = useState(calm);
  useEffect(() => {
    if (calm) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [calm]);
  const chars = [...text];
  return (
    <span className={`inline-flex items-baseline ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex">
        {chars.map((ch, i) => {
          // Keys count from the right, so 99 → 100 rolls the last digits.
          const key = chars.length - i;
          if (!/\d/.test(ch)) {
            return (
              <span key={`c${key}`} className="whitespace-pre">
                {ch}
              </span>
            );
          }
          const d = shown ? Number(ch) : 0;
          return (
            <span key={`d${key}`} className="odo-col">
              <span
                style={{ transform: `translateY(-${d}em)`, transitionDelay: `${(chars.length - i) * 40}ms` }}
              >
                {DIGITS.map((n) => (
                  <span key={n} className="h-[1em]">
                    {n}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** A row of tiny columns for a recent trend; the latest one is highlighted. */
export function MiniBars({
  values,
  tone = 'accent',
  label,
  height = 44,
}: {
  values: number[];
  tone?: ChartTone;
  label: string;
  height?: number;
}) {
  const calm = useCalm();
  const max = Math.max(1, ...values);
  const shown = values.slice(-14);
  return (
    <div className="flex items-end gap-[3px]" style={{ height }} role="img" aria-label={label}>
      {shown.map((v, i) => {
        const last = i === shown.length - 1;
        return (
          <motion.span
            key={i}
            className="w-1.5 rounded-t-[3px]"
            style={{
              height: `${Math.max(6, (v / max) * 100)}%`,
              background: last ? toneColor(tone) : tint(tone, 38),
              originY: 1,
            }}
            initial={calm ? false : { scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ ...spring, delay: 0.15 + i * 0.025 }}
          />
        );
      })}
    </div>
  );
}

/** A key figure: dot and label, a big value, a sentence and a small chart. */
export function KpiCard({
  label,
  tone = 'accent',
  value,
  sub,
  chart,
  delay = 0,
}: {
  label: string;
  tone?: ChartTone;
  value: ReactNode;
  sub?: ReactNode;
  chart?: ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay }}
      className="h-full"
    >
      <Card as="div" className="flex h-full items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-muted uppercase">
            <span className={`size-2 rounded-full ${BG_TONE[tone]}`} aria-hidden />
            {label}
          </span>
          <span className="text-3xl font-semibold tracking-tight">{value}</span>
          {sub ? <span className="text-xs text-muted">{sub}</span> : null}
        </div>
        {chart ? <div className="shrink-0">{chart}</div> : null}
      </Card>
    </motion.div>
  );
}

/** One row of a "worth a look" list: icon, a sentence and an action. */
export function InsightRow({
  icon,
  children,
  action,
  index = 0,
}: {
  icon: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  index?: number;
}) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ ...spring, delay: 0.1 + index * 0.05 }}
      className="flex items-center gap-3 py-2.5"
    >
      {icon}
      <div className="min-w-0 flex-1 text-sm leading-snug">{children}</div>
      {action}
    </motion.li>
  );
}

export interface InstanceChip {
  id: string;
  name: string;
  adapter: string;
  /** A count worth a look (strikes, waiting titles); replaces the status dot. */
  count?: number;
  tone: ChartTone;
}

/** Picks one instance of a feature: chips with the service logo and a status dot or count. */
export function InstanceChips({
  label,
  items,
  current,
  onPick,
}: {
  label: string;
  items: InstanceChip[];
  current?: string;
  onPick: (id: string) => void;
}) {
  const group = useId();
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {items.map((i) => {
        const active = i.id === current;
        return (
          <button
            key={i.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(i.id)}
            className={`relative flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              active ? 'border-transparent text-text' : 'border-border text-muted hover:text-text'
            }`}
          >
            {active ? (
              <motion.span
                layoutId={`chips-${group}`}
                className="absolute inset-0 rounded-full bg-surface-2 ring-1 ring-accent"
                transition={spring}
                aria-hidden
              />
            ) : null}
            <span className="relative flex items-center gap-2">
              <ServiceLogo adapter={i.adapter} name={i.adapter} size={16} />
              <span className="font-medium">{i.name}</span>
              {i.count ? (
                <span className="rounded-full bg-warning-bg px-1.5 text-xs font-semibold text-warning tabular-nums">
                  {i.count}
                </span>
              ) : (
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: toneColor(i.tone) }}
                  aria-hidden
                />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
