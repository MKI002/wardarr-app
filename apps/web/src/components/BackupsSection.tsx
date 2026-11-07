// Settings → Backups: smart retention with one slider, the timeline it keeps,
// and the stored backups with download, restore and upload.
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  planRetention,
  retentionPolicy,
  simulateRetention,
  type BackupKind,
  type KeepReason,
  type RetentionLevel,
  type RetentionPolicy,
} from '@wardarr/core';
import { motion } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api, apiBinary, ApiError } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatBytes, formatRelative } from '../lib/format';
import { tint, toneColor, useCalm, useWidth } from './charts';
import { InsightRow, Odometer, SectionRule } from './dash';
import { ConfirmDialog, Dialog } from './Dialog';
import { Badge, Button, Card, EmptyState, Guardian, InlineError, Skeleton, TextField, spring } from './ui';

// ------------------------------------------------------------------- types

interface BackupInfo {
  id: string;
  kind: BackupKind;
  createdAt: string;
  size: number;
  appVersion: string;
  encrypted: boolean;
  compatibility: 'current' | 'older' | 'newer' | 'foreign';
  key: 'same' | 'included' | 'foreign';
  pinned: boolean;
  keep: KeepReason[];
}

interface LevelInfo extends RetentionPolicy {
  count: number;
  reachDays: number;
  estimatedBytes: number;
}

interface BackupOverview {
  level: RetentionLevel;
  levels: LevelInfo[];
  backups: BackupInfo[];
  lastRun: { at: string; ok: boolean; error?: string } | null;
  nextRunAt: string | null;
  storage: { usedBytes: number; freeBytes: number | null; sameDiskAsData: boolean };
}

const LEVELS: RetentionLevel[] = [0, 1, 2, 3, 4];
const PASSPHRASE_MIN = 10;
const COLLAPSED = 8;

function useBackups() {
  return useQuery({ queryKey: ['backups'], queryFn: () => api<BackupOverview>('/api/backups') });
}

function useLocaleDate() {
  const { i18n } = useTranslation();
  return (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

function useReach() {
  const { t } = useTranslation();
  return (days: number) => {
    if (days < 14) return t('backups.retention.reach.days', { count: Math.max(1, days) });
    if (days < 60) return t('backups.retention.reach.weeks', { count: Math.round(days / 7) });
    if (days < 540) return t('backups.retention.reach.months', { count: Math.round(days / 30.4) });
    return t('backups.retention.reach.years', { count: Math.round(days / 365) });
  };
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- timeline

const DAY = 86_400_000;
const PILL_W = 6;
const PILL_H = 22;
const ROW_Y = 16;
const AXIS_Y = ROW_Y + PILL_H / 2 + 22;
const H = AXIS_Y + 4;

/** Calendar marks under the timeline: weeks, months or quarters, by span. */
function calendarMarks(start: number, end: number, lang: string) {
  const days = (end - start) / DAY;
  const marks: Array<{ at: number; label: string }> = [];
  if (days <= 75) {
    const fmt = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });
    const d = new Date(end);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    for (; d.getTime() > start; d.setDate(d.getDate() - 7))
      marks.push({ at: d.getTime(), label: fmt.format(d) });
    return marks;
  }
  const every = days <= 430 ? 1 : 3;
  const month = new Intl.DateTimeFormat(lang, { month: 'short' });
  const monthYear = new Intl.DateTimeFormat(lang, { month: 'short', year: 'numeric' });
  const d = new Date(end);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  for (; d.getTime() > start; d.setMonth(d.getMonth() - 1)) {
    if (d.getMonth() % every !== 0) continue;
    const label = every === 1 && d.getMonth() !== 0 ? month.format(d) : monthYear.format(d);
    marks.push({ at: d.getTime(), label });
  }
  return marks;
}

/** Rough label width at 11px, enough to keep labels from touching. */
const labelWidth = (s: string) => s.length * 6.2 + 12;

/** Keeps the labels that fit, from the right, without touching each other. */
function fitMarks(marks: Array<{ at: number; label: string }>, x: (at: number) => number, right: number) {
  const out: Array<{ at: number; label: string; x: number }> = [];
  for (const m of marks) {
    const mx = x(m.at);
    const half = labelWidth(m.label) / 2;
    if (mx + half > right || mx - half < 0) continue;
    right = mx - half;
    out.push({ ...m, x: mx });
  }
  return out;
}

interface PillGroup {
  x0: number;
  x1: number;
  count: number;
  newest: string;
  oldest: string;
}

/**
 * Backups closer than `gap` share one pill that stretches over them, so a busy
 * stretch reads as one solid run instead of a smudge. Input is newest first.
 */
function groupPills(points: Array<{ at: string; x: number }>, gap: number): PillGroup[] {
  const out: PillGroup[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && last.x0 - p.x < gap) {
      last.x0 = p.x;
      last.count += 1;
      last.oldest = p.at;
    } else out.push({ x0: p.x, x1: p.x, count: 1, newest: p.at, oldest: p.at });
  }
  return out;
}

/**
 * What a level keeps in the long run, on a plain calendar: today on the right,
 * one line per backup. Recent backups stand close together, older ones thin out.
 */
function Timeline({ policy }: { policy: RetentionPolicy }) {
  const { t, i18n } = useTranslation();
  const calm = useCalm();
  const reach = useReach();
  const date = useLocaleDate();
  const [ref, width] = useWidth<HTMLDivElement>();
  const nowDate = useMemo(() => new Date(), []);
  const now = nowDate.getTime();
  const sim = useMemo(() => simulateRetention(policy, nowDate), [policy, nowDate]);
  const [hover, setHover] = useState<number | null>(null);

  const span = Math.max(sim.reachDays, 7) * DAY * 1.06;
  const start = now - span;
  const x = (at: number) => PILL_W / 2 + ((at - start) / span) * (width - PILL_W);
  const pills = groupPills(
    sim.points.map((p) => ({ at: p.createdAt, x: x(Date.parse(p.createdAt)) })),
    PILL_W + 3,
  );

  const todayLabel = t('backups.retention.today');
  const marks = fitMarks(calendarMarks(start, now, i18n.language), x, width - labelWidth(todayLabel));

  const nearest = (px: number) => {
    const i = pills.findIndex((p) => px >= p.x0 - PILL_W && px <= p.x1 + PILL_W);
    return i < 0 ? null : i;
  };
  const shown = hover === null ? undefined : pills[hover];
  const day = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={ref}
        className="relative"
        role="img"
        aria-label={t('backups.retention.timelineLabel', {
          count: sim.points.length,
          reach: reach(sim.reachDays),
        })}
        onPointerMove={(e) => setHover(nearest(e.clientX - e.currentTarget.getBoundingClientRect().left))}
        onPointerLeave={() => setHover(null)}
      >
        {width > 0 ? (
          <svg width={width} height={H} className="block overflow-visible">
            {marks.map((m) => (
              <g key={m.at}>
                <line x1={m.x} x2={m.x} y1={2} y2={AXIS_Y - 14} stroke="var(--border)" strokeWidth={1} />
                <text x={m.x} y={AXIS_Y} textAnchor="middle" className="fill-[var(--muted)] text-[11px]">
                  {m.label}
                </text>
              </g>
            ))}
            <line x1={0} x2={width} y1={ROW_Y} y2={ROW_Y} stroke="var(--border)" strokeWidth={1} />
            <text x={width} y={AXIS_Y} textAnchor="end" className="fill-[var(--muted)] text-[11px]">
              {todayLabel}
            </text>
            {pills.map((p, i) => (
              <motion.rect
                key={i}
                y={ROW_Y - PILL_H / 2}
                height={PILL_H}
                rx={PILL_W / 2}
                fill={toneColor('accent')}
                style={{ originY: 0.5 }}
                initial={calm ? false : { x: width - PILL_W, width: PILL_W, scaleY: 0 }}
                animate={{
                  x: p.x0 - PILL_W / 2,
                  width: p.x1 - p.x0 + PILL_W,
                  scaleY: hover === i ? 1.25 : 1,
                }}
                transition={
                  calm ? { duration: 0 } : { ...spring, delay: hover === null ? Math.min(0.4, i * 0.015) : 0 }
                }
              />
            ))}
            {pills.map((p, i) =>
              p.x1 - p.x0 + PILL_W >= 30 ? (
                <motion.text
                  key={`n${i}`}
                  y={ROW_Y + 4}
                  textAnchor="middle"
                  className="pointer-events-none fill-[var(--surface)] text-[11px] font-semibold tabular-nums"
                  initial={calm ? false : { x: (p.x0 + p.x1) / 2, opacity: 0 }}
                  animate={{ x: (p.x0 + p.x1) / 2, opacity: 1 }}
                  transition={calm ? { duration: 0 } : spring}
                >
                  {p.count}
                </motion.text>
              ) : null,
            )}
          </svg>
        ) : (
          <div style={{ height: H }} />
        )}
        {shown ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-lg"
            style={{ left: Math.min(Math.max((shown.x0 + shown.x1) / 2, 100), width - 100) }}
          >
            {shown.count === 1
              ? date(shown.newest)
              : t('backups.retention.groupTip', {
                  count: shown.count,
                  from: day.format(new Date(shown.oldest)),
                  to: day.format(new Date(shown.newest)),
                })}
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted">{t('backups.retention.timelineHint')}</p>
    </div>
  );
}

// --------------------------------------------------------------- retention

function retentionSentence(t: (k: string, o?: Record<string, unknown>) => string, p: RetentionPolicy) {
  if (p.intervalHours === null) return t('backups.retention.none', { count: 3 });
  return `${t('backups.retention.every', { count: p.intervalHours })} ${t('backups.retention.thinning')}`;
}

function RetentionCard({ data }: { data: BackupOverview }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const reach = useReach();
  const sliderId = useId();
  const [stopsRef, stopsWidth] = useWidth<HTMLDivElement>();
  const narrow = stopsWidth > 0 && (stopsWidth - 24) / 4 < 96;
  const [level, setLevel] = useState<RetentionLevel>(data.level);
  const dirty = level !== data.level;
  const info = data.levels.find((l) => l.level === level) ?? data.levels[2]!;
  const policy = retentionPolicy(level);

  const removing = useMemo(() => {
    if (!dirty) return new Set<string>();
    return new Set(planRetention(data.backups, policy, new Date()).remove);
  }, [dirty, data.backups, policy]);

  const save = useMutation({
    mutationFn: () => api<BackupOverview>('/api/backups/settings', { method: 'PUT', body: { level } }),
    onSuccess: (next) => client.setQueryData(['backups'], next),
  });

  const stats: Array<[string, string]> =
    level === 0
      ? []
      : [
          [t('backups.retention.statCount'), t('backups.retention.about', { value: info.count })],
          [t('backups.retention.statReach'), t('backups.retention.about', { value: reach(info.reachDays) })],
          [
            t('backups.retention.statSize'),
            t('backups.retention.about', { value: formatBytes(info.estimatedBytes) }),
          ],
        ];

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">{t('backups.retention.title')}</h2>
        <p className="max-w-prose text-sm text-muted">{t('backups.retention.intro')}</p>
      </div>

      <div className="flex flex-col gap-3">
        <label htmlFor={sliderId} className="sr-only">
          {t('backups.retention.slider')}
        </label>
        <div className="px-6">
          <input
            id={sliderId}
            type="range"
            min={0}
            max={4}
            step={1}
            value={level}
            aria-valuetext={`${t(`backups.retention.level.${level}`)}: ${t(`backups.retention.levelHint.${level}`)}`}
            onChange={(e) => setLevel(Number(e.target.value) as RetentionLevel)}
            className="retention-slider block w-full"
            style={{ ['--stop' as string]: level / 4 }}
          />
          {/* Each label sits exactly under its stop: the thumb is 24px wide, so stop
              i is at 12px + (width - 24px) * i / 4. On narrow screens only the
              chosen level is named, so the names never run into each other. */}
          <div ref={stopsRef} className="relative h-10 text-xs">
            {LEVELS.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLevel(l)}
                className={`absolute top-0 flex w-max min-w-8 -translate-x-1/2 flex-col items-center gap-1.5 px-1 text-center leading-tight ${l === level ? 'font-semibold text-text' : 'text-muted hover:text-text'}`}
                style={{ left: `calc(12px + (100% - 24px) * ${l / 4})` }}
              >
                <span className={`h-1.5 w-px ${l <= level ? 'bg-accent' : 'bg-border'}`} aria-hidden />
                <span className={narrow && l !== level ? 'sr-only' : undefined}>
                  {t(`backups.retention.level.${l}`)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-xl bg-surface-2 p-4">
        <p className="text-sm leading-relaxed">{retentionSentence(t, policy)}</p>
        {stats.length ? (
          <dl className="grid grid-cols-3 gap-3">
            {stats.map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      {policy.intervalHours !== null ? <Timeline policy={policy} /> : null}

      {dirty ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"
        >
          <p className={`text-sm ${removing.size ? 'text-warning' : 'text-muted'}`} role="status">
            {removing.size ? t('backups.retention.willRemove', { count: removing.size }) : null}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setLevel(data.level)}>
              {t('backups.retention.reset')}
            </Button>
            <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
              {t('backups.retention.save')}
            </Button>
          </div>
        </motion.div>
      ) : null}
      {save.error ? <InlineError message={errorText(t, save.error).message} /> : null}
    </Card>
  );
}

// -------------------------------------------------------------------- hero

function Hero({ data, onUpload }: { data: BackupOverview; onUpload: () => void }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const create = useMutation({
    mutationFn: () => api<BackupInfo>('/api/backups', { method: 'POST', body: {} }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['backups'] }),
  });
  const latest = data.backups[0];
  const failed = data.lastRun && !data.lastRun.ok ? data.lastRun : null;
  const rel = (iso: string) => formatRelative(iso, i18n.language);

  let sentence: string;
  if (failed) {
    sentence = t(failed.error === 'lowDisk' ? 'backups.hero.lowDisk' : 'backups.hero.failed', {
      when: rel(failed.at),
    });
  } else if (!latest) sentence = t('backups.hero.none');
  else if (!data.nextRunAt) sentence = t('backups.hero.okNoSchedule', { last: rel(latest.createdAt) });
  else sentence = t('backups.hero.ok', { last: rel(latest.createdAt), next: rel(data.nextRunAt) });

  return (
    <Card className="flex flex-wrap items-end justify-between gap-6">
      <div className="flex min-w-0 items-center gap-5">
        <Guardian size={64} happy={!failed} glance />
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
            {t('backups.hero.eyebrow')}
          </span>
          <p className="flex items-baseline gap-2">
            <Odometer text={String(data.backups.length)} className="text-6xl font-bold tracking-tight" />
            <span className="text-lg font-semibold text-muted">
              {t('backups.hero.count', { count: data.backups.length })}
            </span>
          </p>
          <p className={`max-w-prose text-sm ${failed ? 'text-warning' : 'text-muted'}`}>{sentence}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onUpload}>
          {t('backups.hero.upload')}
        </Button>
        <Button variant="primary" busy={create.isPending} onClick={() => create.mutate()}>
          {t('backups.hero.backupNow')}
        </Button>
      </div>
      {create.error ? <InlineError message={errorText(t, create.error).message} /> : null}
    </Card>
  );
}

// -------------------------------------------------------------------- list

function KindIcon({ kind }: { kind: BackupKind }) {
  const paths: Record<BackupKind, ReactNode> = {
    scheduled: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l2.5 2" />
      </>
    ),
    manual: <path d="M12 5v14M5 12h14" />,
    'pre-migration': (
      <>
        <path d="M12 19V7" />
        <path d="m7 11 5-5 5 5" />
      </>
    ),
    'pre-restore': (
      <>
        <path d="M4 12a8 8 0 1 0 2.3-5.6" />
        <path d="M4 4v4h4" />
      </>
    ),
    uploaded: (
      <>
        <path d="M12 15V5" />
        <path d="m8 9 4-4 4 4" />
        <path d="M5 19h14" />
      </>
    ),
  };
  const auto = kind === 'scheduled';
  return (
    <span
      className="grid size-9 shrink-0 place-items-center rounded-full"
      style={{
        background: tint(auto ? 'accent' : 'neutral', 16),
        color: toneColor(auto ? 'accent' : 'neutral'),
      }}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {paths[kind]}
      </svg>
    </span>
  );
}

function BackupRow({
  backup,
  index,
  onRestore,
  onExport,
  onDelete,
}: {
  backup: BackupInfo;
  index: number;
  onRestore: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const date = useLocaleDate();
  const pin = useMutation({
    mutationFn: (pinned: boolean) =>
      api(`/api/backups/${encodeURIComponent(backup.id)}/pin`, { method: 'PUT', body: { pinned } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['backups'] }),
  });
  const restorable = backup.compatibility === 'current' || backup.compatibility === 'older';

  return (
    <InsightRow
      index={index}
      icon={<KindIcon kind={backup.kind} />}
      action={
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={t('backups.list.actions')}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-56 rounded-xl border border-border bg-surface p-1 shadow-lg"
            >
              {restorable ? <MenuItem onSelect={onRestore}>{t('backups.list.restore')}</MenuItem> : null}
              <MenuItem
                onSelect={() => {
                  window.location.href = `/api/backups/${encodeURIComponent(backup.id)}/download`;
                }}
              >
                {t('backups.list.download')}
              </MenuItem>
              {!backup.encrypted ? (
                <MenuItem onSelect={onExport}>{t('backups.list.downloadProtected')}</MenuItem>
              ) : null}
              <MenuItem onSelect={() => pin.mutate(!backup.pinned)}>
                {backup.pinned ? t('backups.list.unpin') : t('backups.list.pin')}
              </MenuItem>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <MenuItem onSelect={onDelete} danger>
                {t('backups.list.delete')}
              </MenuItem>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      }
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{date(backup.createdAt)}</span>
        <span className="text-xs text-muted">{formatRelative(backup.createdAt, i18n.language)}</span>
        {backup.pinned ? <Badge tone="neutral">{t('backups.badge.pinned')}</Badge> : null}
        {backup.encrypted ? <Badge tone="neutral">{t('backups.badge.encrypted')}</Badge> : null}
        {backup.compatibility === 'older' ? <Badge tone="info">{t('backups.badge.older')}</Badge> : null}
        {backup.compatibility === 'newer' ? <Badge tone="critical">{t('backups.badge.newer')}</Badge> : null}
        {backup.compatibility === 'foreign' ? (
          <Badge tone="critical">{t('backups.badge.foreign')}</Badge>
        ) : null}
        {backup.key === 'foreign' ? <Badge tone="warning">{t('backups.badge.otherKey')}</Badge> : null}
      </div>
      <p className="mt-0.5 text-xs text-muted">
        {[
          t(`backups.kind.${backup.kind}`),
          formatBytes(backup.size),
          t('backups.list.version', { version: backup.appVersion }),
          backup.keep.length === 0 ? t('backups.list.goesSoon') : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {pin.error ? <InlineError message={errorText(t, pin.error).message} /> : null}
    </InsightRow>
  );
}

function MenuItem({
  children,
  onSelect,
  danger,
}: {
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={`cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2 ${danger ? 'text-critical' : ''}`}
    >
      {children}
    </DropdownMenu.Item>
  );
}

// ----------------------------------------------------------------- dialogs

function RestoreDialog({ backup, onClose }: { backup: BackupInfo | null; onClose: () => void }) {
  const { t } = useTranslation();
  const date = useLocaleDate();
  const [passphrase, setPassphrase] = useState('');
  const [acceptForeign, setAcceptForeign] = useState(false);
  const [restarting, setRestarting] = useState<{ cleared: number } | null>(null);

  const restore = useMutation({
    mutationFn: () =>
      api<{ credentialsCleared: number }>(`/api/backups/${encodeURIComponent(backup!.id)}/restore`, {
        method: 'POST',
        body: {
          ...(backup!.encrypted ? { passphrase } : {}),
          ...(acceptForeign ? { acceptKeyMismatch: true } : {}),
        },
      }),
    onSuccess: (res) => setRestarting({ cleared: res.credentialsCleared }),
  });

  // Wait for the server to go down and come back, then reload into the login.
  useEffect(() => {
    if (!restarting) return;
    let cancelled = false;
    const started = Date.now();
    let sawDown = false;
    const poll = async () => {
      while (!cancelled) {
        await new Promise((r) => setTimeout(r, 700));
        const up = await fetch('/healthz', { cache: 'no-store' })
          .then((r) => r.ok)
          .catch(() => false);
        if (!up) sawDown = true;
        if (up && (sawDown || Date.now() - started > 4000)) {
          window.location.assign('/');
          return;
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [restarting]);

  if (restarting) {
    return (
      <Dialog open onOpenChange={() => undefined} title={t('backups.restore.restarting')}>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <Guardian size={72} glance />
          <p className="text-sm text-muted">{t('backups.restore.restartingBody')}</p>
          {restarting.cleared > 0 ? (
            <p className="text-sm text-warning">
              {t('backups.restore.cleared', { count: restarting.cleared })}
            </p>
          ) : null}
        </div>
      </Dialog>
    );
  }

  const needsAccept = backup?.key === 'foreign';
  const blocked = (backup?.encrypted && passphrase.length === 0) || (needsAccept && !acceptForeign);
  return (
    <Dialog
      open={backup !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('backups.restore.title')}
      description={backup ? t('backups.restore.body', { date: date(backup.createdAt) }) : undefined}
    >
      {backup ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!blocked) restore.mutate();
          }}
        >
          {backup.compatibility === 'older' ? (
            <p className="text-sm text-info">{t('backups.restore.older')}</p>
          ) : null}
          {backup.encrypted ? (
            <TextField
              label={t('backups.restore.passphrase')}
              type="password"
              autoComplete="off"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              required
            />
          ) : null}
          {needsAccept ? (
            <div className="flex flex-col gap-2 rounded-xl bg-warning-bg p-3 text-sm">
              <p className="text-warning">{t('backups.restore.foreignKey')}</p>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--accent)]"
                  checked={acceptForeign}
                  onChange={(e) => setAcceptForeign(e.target.checked)}
                />
                <span>{t('backups.restore.acceptForeign')}</span>
              </label>
            </div>
          ) : null}
          {restore.error ? <InlineError message={errorText(t, restore.error).message} /> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              {t('ui.common.cancel')}
            </Button>
            <Button type="submit" variant="primary" busy={restore.isPending} disabled={blocked}>
              {t('backups.restore.confirm')}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}

function ExportDialog({ backup, onClose }: { backup: BackupInfo | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const mismatch = second.length > 0 && first !== second;
  const run = useMutation({
    mutationFn: () =>
      apiBinary(`/api/backups/${encodeURIComponent(backup!.id)}/export`, {
        method: 'POST',
        body: { passphrase: first },
      }),
    onSuccess: (res) => {
      saveBlob(res.blob, res.filename ?? `${backup!.id}-protected.wbak`);
      onClose();
    },
  });
  return (
    <Dialog
      open={backup !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('backups.export.title')}
      description={t('backups.export.body')}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (first.length >= PASSPHRASE_MIN && first === second) run.mutate();
        }}
      >
        <TextField
          label={t('backups.export.passphrase')}
          type="password"
          autoComplete="new-password"
          minLength={PASSPHRASE_MIN}
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          help={t('backups.export.help', { count: PASSPHRASE_MIN })}
          required
        />
        <TextField
          label={t('backups.export.repeat')}
          type="password"
          autoComplete="new-password"
          value={second}
          onChange={(e) => setSecond(e.target.value)}
          required
        />
        {mismatch ? <p className="text-sm text-critical">{t('backups.export.mismatch')}</p> : null}
        {run.error ? <InlineError message={errorText(t, run.error).message} /> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('ui.common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            busy={run.isPending}
            disabled={first.length < PASSPHRASE_MIN || first !== second}
          >
            {t('backups.export.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// -------------------------------------------------------------------- page

export function BackupsSection() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const backups = useBackups();
  const date = useLocaleDate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  const [exporting, setExporting] = useState<BackupInfo | null>(null);
  const [deleting, setDeleting] = useState<BackupInfo | null>(null);
  const [showAll, setShowAll] = useState(false);

  const upload = useMutation({
    mutationFn: (file: File) => apiBinary('/api/backups/upload', { method: 'POST', body: file }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['backups'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/backups/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(null);
      void client.invalidateQueries({ queryKey: ['backups'] });
    },
  });

  if (backups.isError)
    return <InlineError message={t('ui.errors.loadFailed')} onRetry={() => void backups.refetch()} />;
  if (!backups.data) return <Skeleton className="h-64 rounded-[var(--radius-card)]" />;
  const data = backups.data;

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-xl text-sm text-muted">{t('backups.intro')}</p>
      <Hero data={data} onUpload={() => fileInput.current?.click()} />
      <input
        ref={fileInput}
        type="file"
        accept=".wbak,.db,.sqlite,application/octet-stream"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload.mutate(file);
          e.target.value = '';
        }}
      />
      {upload.error ? (
        <InlineError
          message={
            upload.error instanceof ApiError && upload.error.status === 413
              ? t('backups.errors.tooLarge')
              : errorText(t, upload.error).message
          }
        />
      ) : null}
      {upload.isSuccess ? (
        <p role="status" className="text-sm text-ok">
          {t('backups.uploaded')}
        </p>
      ) : null}

      <RetentionCard key={data.level} data={data} />

      <SectionRule>{t('backups.list.title')}</SectionRule>
      <Card className="flex flex-col gap-1 py-2">
        {data.backups.length === 0 ? (
          <EmptyState title={t('backups.list.empty')} body={t('backups.list.emptyBody')} />
        ) : (
          <ul className="divide-y divide-border">
            {(showAll ? data.backups : data.backups.slice(0, COLLAPSED)).map((b, i) => (
              <BackupRow
                key={b.id}
                backup={b}
                index={i}
                onRestore={() => setRestoring(b)}
                onExport={() => setExporting(b)}
                onDelete={() => setDeleting(b)}
              />
            ))}
          </ul>
        )}
        {data.backups.length > COLLAPSED ? (
          <Button variant="ghost" className="self-center" onClick={() => setShowAll(!showAll)}>
            {showAll ? t('backups.list.showLess') : t('backups.list.showAll', { count: data.backups.length })}
          </Button>
        ) : null}
        <ul className="border-t border-border pt-1">
          {data.storage.sameDiskAsData ? (
            <InsightRow icon={<StorageIcon tone="warning" />} index={0}>
              <span className="text-muted">{t('backups.insight.sameDisk')}</span>
            </InsightRow>
          ) : null}
          <InsightRow icon={<StorageIcon tone="accent" />} index={1}>
            <span className="text-muted">
              {t('backups.insight.storage', {
                used: formatBytes(data.storage.usedBytes),
                free: formatBytes(data.storage.freeBytes),
              })}
            </span>
          </InsightRow>
        </ul>
      </Card>

      <RestoreDialog key={`r-${restoring?.id}`} backup={restoring} onClose={() => setRestoring(null)} />
      <ExportDialog key={`e-${exporting?.id}`} backup={exporting} onClose={() => setExporting(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('backups.delete.title')}
        body={deleting ? t('backups.delete.body', { date: date(deleting.createdAt) }) : ''}
        confirmLabel={t('backups.delete.confirm')}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        busy={remove.isPending}
        danger
      />
    </div>
  );
}

function StorageIcon({ tone }: { tone: 'warning' | 'accent' }) {
  return (
    <span
      className="grid size-9 shrink-0 place-items-center rounded-full"
      style={{ background: tint(tone, 16), color: toneColor(tone) }}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <ellipse cx="12" cy="6" rx="7" ry="3" />
        <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
        <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
      </svg>
    </span>
  );
}
