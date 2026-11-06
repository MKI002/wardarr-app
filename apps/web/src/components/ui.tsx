// Basic building blocks. Animations stay short (150-300 ms) and follow
// the user's reduced-motion setting through MotionConfig.
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import {
  forwardRef,
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

export const spring = { type: 'spring', stiffness: 420, damping: 32, mass: 0.8 } as const;

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
    <As className={`rounded-[var(--radius-card)] border border-border bg-surface p-5 ${className}`}>
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
    warning: 'bg-warning',
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

/** The Wardarr guardian: a small owl inside a shield. */
export function Guardian({
  size = 64,
  happy = true,
  className = '',
}: {
  size?: number;
  happy?: boolean;
  className?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <path d="M32 6 11 14v16c0 13.5 9 23.5 21 27 12-3.5 21-13.5 21-27V14Z" className="fill-accent" />
      <circle cx="24.5" cy="29" r="6" className="fill-surface" />
      <circle cx="39.5" cy="29" r="6" className="fill-surface" />
      <circle cx="25.5" cy="28" r="2.4" className="fill-text" />
      <circle cx="40.5" cy="28" r="2.4" className="fill-text" />
      <path d="m30 36 2 3 2-3Z" className="fill-surface" />
      {happy ? (
        <path
          d="M26 44q6 4.5 12 0"
          className="stroke-surface"
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
      ) : (
        <path d="M26 45h12" className="stroke-surface" strokeWidth="2.6" strokeLinecap="round" />
      )}
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
        <Guardian size={56} />
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
