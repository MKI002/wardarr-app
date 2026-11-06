// Basic building blocks. Animations stay short (150-300 ms) and follow
// the user's reduced-motion setting through MotionConfig.
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import {
  forwardRef,
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

export const spring = { type: 'spring', stiffness: 420, damping: 32, mass: 0.8 } as const;

/**
 * Swaps one view for another, e.g. a page, a tab or a settings section: the new
 * view fades in and the old one leaves at once. There is deliberately no exit
 * animation: with AnimatePresence mode="wait", leaving a view and coming back
 * while its exit was still running left the view stuck at opacity 0. A fresh
 * element per `view` always plays its entry to the end, however fast you switch.
 */
export function ViewTransition({
  view,
  from = 'below',
  children,
}: {
  view: string;
  /** `side` slides in from the right, for steps that move forward. */
  from?: 'below' | 'side';
  children: ReactNode;
}) {
  return (
    <motion.div
      key={view}
      initial={from === 'side' ? { opacity: 0, x: 16 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast hover:opacity-90',
  secondary: 'bg-surface-2 text-text hover:bg-border',
  ghost: 'text-muted hover:text-text hover:bg-surface-2',
  danger: 'bg-critical-bg text-critical hover:opacity-90',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }
>(function Button({ variant = 'secondary', busy, className = '', children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {busy ? (
        <span className="size-3.5 animate-pulse rounded-full bg-current opacity-60" aria-hidden />
      ) : null}
      {children}
    </button>
  );
});

/** Moves a card's soft highlight to the pointer (see .card-glow). */
function glowAt(e: PointerEvent<HTMLElement>) {
  if (e.pointerType === 'touch') return;
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
}

export function Card({
  children,
  className = '',
  as: As = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'li';
}) {
  return (
    <As
      className={`card-glow rounded-[var(--radius-card)] border border-border bg-surface p-5 ${className}`}
      onPointerMove={glowAt}
    >
      {children}
    </As>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{children}</h2>
      {action}
    </div>
  );
}

export type Tone = 'critical' | 'warning' | 'info' | 'ok' | 'neutral';

const TONES: Record<Tone, string> = {
  critical: 'bg-critical-bg text-critical',
  warning: 'bg-warning-bg text-warning',
  info: 'bg-info-bg text-info',
  ok: 'bg-ok-bg text-ok',
  neutral: 'bg-surface-2 text-muted',
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusDot({ tone, label }: { tone: Tone; label: string }) {
  const color = {
    critical: 'bg-critical',
    warning: 'bg-warning-mark',
    info: 'bg-info',
    ok: 'bg-ok',
    neutral: 'bg-muted',
  }[tone];
  return (
    <span className="inline-flex items-center">
      <span className={`size-2.5 rounded-full ${color}`} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** Counts up (or down) to a new value when it changes. */
export function CountUp({
  value,
  format = (n) => String(Math.round(n)),
}: {
  value: number;
  format?: (n: number) => string;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (n) => format(n));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.3, ease: 'easeOut' });
    return () => controls.stop();
  }, [value, reduce, mv]);
  return (
    <>
      <motion.span aria-hidden>{text}</motion.span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}

export function ProgressBar({
  value,
  tone = 'accent',
  label,
}: {
  value: number;
  tone?: 'accent' | 'ok' | 'warning';
  label: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color = { accent: 'bg-accent', ok: 'bg-ok', warning: 'bg-warning' }[tone];
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.6, ease: 'linear' }}
      />
    </div>
  );
}

/**
 * The Wardarr guardian ("Schildwache"): a shield with an open eye. With
 * `glance` the eye looks left and right once, for empty and loading states;
 * reduced motion keeps it still. `happy={false}` lowers the gaze.
 */
export function Guardian({
  size = 64,
  happy = true,
  glance = false,
  className = '',
}: {
  size?: number;
  happy?: boolean;
  glance?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const animateIris = glance && !reduce;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <path d="M32 7l20 7.5V30c0 13-8.6 22.6-20 27-11.4-4.4-20-14-20-27V14.5Z" className="fill-accent" />
      <path
        d="M17.5 31c3.7-6.4 8.6-9.8 14.5-9.8S42.8 24.6 46.5 31c-3.7 6.4-8.6 9.8-14.5 9.8S21.2 37.4 17.5 31Z"
        className="fill-bg"
      />
      <motion.g
        initial={false}
        animate={animateIris ? { x: [0, -4, 4, 0] } : { x: 0, y: happy ? 0 : 2.5 }}
        transition={animateIris ? { duration: 1.6, ease: 'easeInOut', delay: 0.3 } : spring}
      >
        <circle cx="32" cy="31" r="5.6" className="fill-accent" />
        <circle cx="33.9" cy="29.3" r="1.7" className="fill-text" />
      </motion.g>
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <Guardian size={28} />
      <span className="text-lg">Wardarr</span>
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <motion.div initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring}>
        <Guardian size={56} glance />
      </motion.div>
      <p className="font-medium">{title}</p>
      {body ? <p className="max-w-sm text-sm text-muted">{body}</p> : null}
      {action}
    </div>
  );
}

/** An error shown where it happened, with the next step. */
export function InlineError({
  message,
  next,
  onRetry,
}: {
  message: string;
  next?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-lg bg-critical-bg px-3 py-2 text-sm text-critical"
    >
      <span>
        {message}
        {next ? <span className="text-text"> {next}</span> : null}
      </span>
      {onRetry ? (
        <Button variant="ghost" onClick={onRetry} className="ml-auto">
          {t('ui.common.retry')}
        </Button>
      ) : null}
    </div>
  );
}

export function TextField({
  label,
  help,
  error,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; help?: string; error?: string }) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-describedby={help || error ? `${id}-hint` : undefined}
        aria-invalid={error ? true : undefined}
        className="min-h-10 rounded-lg border border-border bg-bg px-3 text-sm outline-none placeholder:text-muted focus:border-accent"
        {...rest}
      />
      {error || help ? (
        <p id={`${id}-hint`} className={`text-xs ${error ? 'text-critical' : 'text-muted'}`}>
          {error ?? help}
        </p>
      ) : null}
    </div>
  );
}

/** A row of radio choices that look like buttons. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (v: T) => void;
  hideLabel?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={hideLabel ? 'sr-only' : 'mb-2 text-sm font-medium'}>{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([id, text]) => (
          <label
            key={id}
            className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors focus-within:ring-2 focus-within:ring-accent ${value === id ? 'border-accent bg-surface-2' : 'border-border hover:bg-surface-2'}`}
          >
            <input type="radio" className="sr-only" checked={value === id} onChange={() => onChange(id)} />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** An on/off switch with a label and an optional hint. */
export function Toggle({
  label,
  help,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  help?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {help ? <p className="text-xs text-muted">{help}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-border'}`}
      >
        <motion.span
          className="inline-block size-5 rounded-full bg-surface shadow"
          initial={false}
          animate={{ x: checked ? 22 : 2 }}
          transition={spring}
        />
      </button>
    </div>
  );
}

/** A number input with a unit. */
export function NumberField({
  label,
  help,
  value,
  onChange,
  min,
  max,
  unit,
}: {
  label: string;
  help?: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  unit?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
          aria-describedby={help ? `${id}-hint` : undefined}
          className="min-h-10 w-28 rounded-lg border border-border bg-bg px-3 text-sm tabular-nums outline-none focus:border-accent"
        />
        {unit ? <span className="text-sm text-muted">{unit}</span> : null}
      </div>
      {help ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {help}
        </p>
      ) : null}
    </div>
  );
}

/** Folds less important settings away under "Advanced". */
export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
        {title}
        <svg
          viewBox="0 0 24 24"
          className="size-4 text-muted transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="flex flex-col gap-4 border-t border-border px-4 py-4">{children}</div>
    </details>
  );
}

/** Strikes as a row of dots. */
export function StrikeMeter({ strikes, max, label }: { strikes: number; max: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={label}>
      {Array.from({ length: Math.min(max, 12) }, (_, i) => (
        <motion.span
          key={i}
          className={`size-2 rounded-full ${i < strikes ? 'bg-critical' : 'bg-border'}`}
          initial={false}
          animate={{ scale: i === strikes - 1 ? [1, 1.4, 1] : 1 }}
          transition={{ duration: 0.25 }}
        />
      ))}
    </span>
  );
}

/** Sub-navigation inside a page. */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<[T, string, number?]>;
  onChange: (v: T) => void;
  label: string;
}) {
  const layoutId = useId();
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-border">
      {options.map(([id, text, count]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={`relative min-h-10 shrink-0 px-3 text-sm font-medium ${value === id ? 'text-text' : 'text-muted hover:text-text'}`}
        >
          {text}
          {count ? (
            <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-xs tabular-nums">{count}</span>
          ) : null}
          {value === id ? (
            <motion.span
              layoutId={layoutId}
              className="absolute inset-x-2 -bottom-px h-0.5 rounded bg-accent"
              transition={spring}
            />
          ) : null}
        </button>
      ))}
    </div>
  );
}

/** A native select with a label. */
export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-10 rounded-lg border border-border bg-bg px-3 text-sm font-normal outline-none focus:border-accent"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
