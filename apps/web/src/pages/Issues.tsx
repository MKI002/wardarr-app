// Issue Center: one entry per cause, with explanation, fix and actions.
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { IssueAction } from '@wardarr/core';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Columns, SegmentBar, BarRow } from '../components/charts';
import { Odometer, PageHeader, SectionRule } from '../components/dash';
import { ConfirmDialog } from '../components/Dialog';
import { IssueIcon } from '../components/IssueIcon';
import { ServiceLogo } from '../components/ServiceLogo';
import { Badge, Button, Card, EmptyState, InlineError, Skeleton, spring, type Tone } from '../components/ui';
import { api, type IssueView } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatRelative } from '../lib/format';
import { tm } from '../lib/i18n';

type View = 'open' | 'muted' | 'resolved';

const SEVERITY_TONE: Record<string, Tone> = { critical: 'critical', warning: 'warning', info: 'info' };
const SEVERITY_BAR: Record<string, string> = {
  critical: 'bg-critical',
  warning: 'bg-warning-mark',
  info: 'bg-info',
};

const MUTE_OPTIONS: Array<{ id: 'hour' | 'day' | 'week' | 'forever'; minutes?: number }> = [
  { id: 'hour', minutes: 60 },
  { id: 'day', minutes: 60 * 24 },
  { id: 'week', minutes: 60 * 24 * 7 },
  { id: 'forever' },
];

export function useIssues() {
  return useQuery({ queryKey: ['issues', 'all'], queryFn: () => api<IssueView[]>('/api/issues?status=all') });
}

function viewOf(i: IssueView): View {
  if (i.status === 'resolved') return 'resolved';
  return i.muted ? 'muted' : 'open';
}

function useIssueMutations(fp: string) {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['issues'] });
    void client.invalidateQueries({ queryKey: ['overview'] });
  };
  return {
    recheck: useMutation({
      mutationFn: () => api<IssueView>(`/api/issues/${encodeURIComponent(fp)}/recheck`, { method: 'POST' }),
      onSettled: refresh,
    }),
    mute: useMutation({
      mutationFn: (minutes?: number) =>
        api<IssueView>(`/api/issues/${encodeURIComponent(fp)}/mute`, {
          method: 'POST',
          body: minutes ? { minutes } : {},
        }),
      onSettled: refresh,
    }),
    unmute: useMutation({
      mutationFn: () => api<IssueView>(`/api/issues/${encodeURIComponent(fp)}/unmute`, { method: 'POST' }),
      onSettled: refresh,
    }),
    action: useMutation({
      mutationFn: (id: string) =>
        api<{ ok: boolean; message: string | null }>(
          `/api/issues/${encodeURIComponent(fp)}/actions/${encodeURIComponent(id)}`,
          { method: 'POST' },
        ),
      onSettled: refresh,
    }),
  };
}

function MuteMenu({ onMute, busy }: { onMute: (minutes?: number) => void; busy: boolean }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" busy={busy}>
          {t('issues.action.mute')}
          <svg
            viewBox="0 0 24 24"
            className="size-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-44 rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          {MUTE_OPTIONS.map((o) => (
            <DropdownMenu.Item
              key={o.id}
              onSelect={() => onMute(o.minutes)}
              className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2"
            >
              {t(`ui.issues.muteFor.${o.id}`)}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function IssueActions({ issue }: { issue: IssueView }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const m = useIssueMutations(issue.fingerprint);
  const [steps, setSteps] = useState<IssueAction | null>(null);
  const [confirm, setConfirm] = useState<IssueAction | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const run = (a: IssueAction) => {
    setFeedback(null);
    if (a.kind === 'recheck') {
      m.recheck.mutate(undefined, {
        onSuccess: (next) =>
          setFeedback(
            next.status === 'resolved'
              ? { ok: true, text: t('ui.issues.recheckResolved') }
              : { ok: false, text: t('ui.issues.recheckStill') },
          ),
        onError: (err) => setFeedback({ ok: false, text: errorText(t, err).message }),
      });
      return;
    }
    if (a.kind === 'openWardarr' && a.href) {
      void navigate({ href: a.href });
      return;
    }
    if (a.kind === 'guide') {
      setSteps(steps?.id === a.id ? null : a);
      return;
    }
    if (a.class === 'risky') {
      setConfirm(a);
      return;
    }
    runServer(a);
  };

  const runServer = (a: IssueAction) =>
    m.action.mutate(a.id, {
      onSuccess: (r) =>
        setFeedback(
          r.ok
            ? { ok: true, text: t('ui.issues.actionOk') }
            : { ok: false, text: t('ui.issues.actionFailed', { reason: r.message ?? '' }) },
        ),
      onError: (err) =>
        setFeedback({ ok: false, text: t('ui.issues.actionFailed', { reason: errorText(t, err).message }) }),
      onSettled: () => setConfirm(null),
    });

  if (issue.status === 'resolved') return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {issue.group.actions.map((a, index) => {
          if (a.kind === 'mute') {
            return issue.muted ? (
              <Button key={a.id} variant="ghost" busy={m.unmute.isPending} onClick={() => m.unmute.mutate()}>
                {t('ui.issues.unmute')}
              </Button>
            ) : (
              <MuteMenu key={a.id} busy={m.mute.isPending} onMute={(minutes) => m.mute.mutate(minutes)} />
            );
          }
          if (a.kind === 'openLink' && a.href) {
            return (
              <a
                key={a.id}
                href={a.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-surface-2 px-3.5 text-sm font-medium hover:bg-border"
              >
                {tm(t, a.label)}
                <svg
                  viewBox="0 0 24 24"
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                </svg>
              </a>
            );
          }
          const busy =
            (a.kind === 'recheck' && m.recheck.isPending) ||
            (m.action.isPending && m.action.variables === a.id);
          return (
            <Button
              key={a.id}
              variant={index === 0 && a.kind !== 'recheck' ? 'primary' : 'secondary'}
              busy={busy}
              onClick={() => run(a)}
              aria-expanded={a.kind === 'guide' ? steps?.id === a.id : undefined}
            >
              {a.kind === 'recheck' && busy ? t('ui.issues.rechecking') : tm(t, a.label)}
            </Button>
          );
        })}
      </div>
      <AnimatePresence>
        {feedback ? (
          <motion.p
            key={feedback.text}
            role="status"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`text-sm ${feedback.ok ? 'text-ok' : 'text-muted'}`}
          >
            {feedback.text}
          </motion.p>
        ) : null}
        {steps?.steps ? (
          <motion.ol
            key="steps"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="list-decimal space-y-1 overflow-hidden rounded-lg bg-surface-2 py-3 pr-3 pl-8 text-sm"
          >
            {steps.steps.map((s, i) => (
              <li key={i}>{tm(t, s)}</li>
            ))}
          </motion.ol>
        ) : null}
      </AnimatePresence>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm ? tm(t, confirm.label) : ''}
        body={confirm?.confirm ? tm(t, confirm.confirm) : ''}
        confirmLabel={t('ui.common.confirm')}
        busy={m.action.isPending}
        onConfirm={() => confirm && runServer(confirm)}
      />
    </div>
  );
}

function IssueCard({ issue, focused }: { issue: IssueView; focused: boolean }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(focused);
  const ref = useRef<HTMLLIElement>(null);
  const g = issue.group;
  const bodyId = `issue-${g.fingerprint.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  const [wasFocused, setWasFocused] = useState(focused);
  if (focused !== wasFocused) {
    setWasFocused(focused);
    if (focused) setOpen(true);
  }
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focused]);

  const affected = tm(t, g.affected);
  const when =
    issue.status === 'resolved'
      ? t('ui.issues.resolvedAt', { when: formatRelative(issue.resolvedAt, i18n.language) })
      : issue.muted
        ? issue.mutedForever
          ? t('ui.issues.mutedForever')
          : t('ui.issues.mutedUntil', { when: formatRelative(issue.mutedUntil, i18n.language) })
        : t('ui.issues.since', { when: formatRelative(issue.firstSeenAt, i18n.language) });

  return (
    <motion.li
      ref={ref}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.25 } }}
      transition={spring}
      className={`relative overflow-hidden rounded-[var(--radius-card)] border bg-surface ${focused ? 'border-accent' : 'border-border'}`}
    >
      <span
        className={`absolute inset-y-0 left-0 w-1 ${SEVERITY_BAR[g.severity] ?? 'bg-muted'} ${issue.status !== 'open' ? 'opacity-30' : ''}`}
        aria-hidden
      />
      <button
        type="button"
        className="flex w-full items-start gap-3 py-4 pr-4 pl-5 text-left"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <IssueIcon
          fingerprint={g.fingerprint}
          tone={
            issue.status === 'open' && !issue.muted ? (SEVERITY_TONE[g.severity] ?? 'neutral') : 'neutral'
          }
          label={t(`ui.issues.severity.${g.severity}`)}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="font-semibold">{tm(t, g.title)}</h3>
          <p className="text-sm text-muted">
            <span className="sr-only">{t('ui.issues.affected')}: </span>
            {affected}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {g.instances.map((i) => (
              <span
                key={i.id}
                className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5"
              >
                <ServiceLogo adapter={i.adapter} name={i.name} size={12} />
                {i.name}
              </span>
            ))}
            <span>{when}</span>
          </p>
        </div>
        <Badge tone={SEVERITY_TONE[g.severity] ?? 'neutral'}>{t(`ui.issues.severity.${g.severity}`)}</Badge>
        <motion.svg
          animate={{ rotate: open ? 180 : 0 }}
          transition={spring}
          viewBox="0 0 24 24"
          className="mt-1 size-5 shrink-0 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </motion.svg>
        <span className="sr-only">{open ? t('ui.issues.collapse') : t('ui.issues.expand')}</span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={bodyId}
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-4 border-t border-border py-4 pr-4 pl-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                    {t('ui.issues.why')}
                  </h4>
                  <p className="text-sm">{tm(t, g.explanation)}</p>
                </div>
                <div>
                  <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                    {t('ui.issues.fix')}
                  </h4>
                  <p className="text-sm">{tm(t, g.fix)}</p>
                </div>
              </div>
              {g.items.length > 0 ? (
                <div>
                  <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                    {t('ui.issues.items')}
                  </h4>
                  <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                    {g.items.map((item, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.info ? <span className="text-muted">{tm(t, item.info)}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <IssueActions issue={issue} />
              {g.details.length > 0 ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted hover:text-text">
                    {t('ui.issues.original')}
                  </summary>
                  <ul className="mt-2 space-y-1.5">
                    {g.details.map((d, i) => (
                      <li key={i} className="rounded-lg bg-surface-2 px-3 py-2">
                        <span className="font-medium">{d.instance.name}</span>
                        {d.source ? <span className="text-muted"> · {d.source}</span> : null}
                        <p className="mt-0.5 break-words text-muted">{d.message}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

function IssueList({ issues, focus }: { issues: IssueView[]; focus?: string }) {
  return (
    <ul className="flex flex-col gap-3">
      <AnimatePresence initial={false} mode="popLayout">
        {issues.map((i) => (
          <IssueCard key={i.fingerprint} issue={i} focused={focus === i.fingerprint} />
        ))}
      </AnimatePresence>
    </ul>
  );
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };
const SEVERITIES = ['critical', 'warning', 'info'] as const;

interface TimelineDay {
  day: string;
  critical: number;
  warning: number;
  info: number;
}

const tzOffset = () => -new Date().getTimezoneOffset();

/** Open issues at a glance: how many, how bad, since when and where. */
function IssuesHero({ issues }: { issues: IssueView[] }) {
  const { t, i18n } = useTranslation();
  const timeline = useQuery({
    queryKey: ['issues', 'timeline'],
    queryFn: () => api<{ days: TimelineDay[] }>(`/api/issues/timeline?days=14&tz=${tzOffset()}`),
  });
  const open = issues.filter((i) => viewOf(i) === 'open');
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const i of open) counts[i.group.severity]++;
  const [fortnight] = useState(() => Date.now() - 14 * 86_400_000);
  const resolved = issues.filter((i) => i.resolvedAt && Date.parse(i.resolvedAt) >= fortnight).length;
  const sentence =
    open.length === 0
      ? t('ui.issues.heroClear')
      : counts.critical > 0
        ? t('ui.issues.heroCritical', { count: counts.critical })
        : t('ui.issues.heroCalm');

  // Which services report the most open issues.
  const perInstance = new Map<string, { name: string; adapter: string; count: number }>();
  for (const i of open)
    for (const inst of i.group.instances) {
      const e = perInstance.get(inst.id) ?? { name: inst.name, adapter: inst.adapter, count: 0 };
      e.count++;
      perInstance.set(inst.id, e);
    }
  const top = [...perInstance.values()].sort((a, b) => b.count - a.count).slice(0, 4);
  const dayLabel = (day: string) =>
    new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(
      new Date(`${day}T12:00:00`),
    );

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <Card className="grid gap-8 lg:grid-cols-[1fr_1.6fr_1fr] lg:p-7">
        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
            {t('ui.issues.open')}
          </span>
          <span className="text-6xl leading-none font-bold tracking-tight">
            <Odometer text={String(open.length)} />
          </span>
          <p className="font-medium text-balance">{sentence}</p>
          <div className="mt-auto pt-2">
            <SegmentBar
              tall
              label={t('ui.issues.bySeverity')}
              segments={SEVERITIES.map((s) => ({
                key: s,
                label: t(`ui.issues.severity.${s}`),
                value: counts[s],
                tone: s,
              }))}
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
              {t('ui.issues.newPerDay')}
            </span>
            <span className="text-xs text-muted">{t('ui.issues.resolvedRecently', { count: resolved })}</span>
          </div>
          <Columns
            height={150}
            label={t('ui.issues.newPerDay')}
            emptyLabel={t('ui.issues.noneNew')}
            data={(timeline.data?.days ?? []).map((d) => ({
              key: d.day,
              label: dayLabel(d.day),
              parts: SEVERITIES.map((s) => ({ tone: s, value: d[s], label: t(`ui.issues.severity.${s}`) })),
            }))}
          />
        </div>
        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
            {t('ui.issues.byService')}
          </span>
          {top.length === 0 ? (
            <p className="text-sm text-muted">{t('ui.issues.allClear')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {top.map((e, i) => (
                <BarRow
                  key={e.name}
                  delay={0.1 + i * 0.05}
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <ServiceLogo adapter={e.adapter} name={e.name} size={14} />
                      {e.name}
                    </span>
                  }
                  value={e.count}
                  max={top[0]?.count ?? 1}
                  display={e.count}
                />
              ))}
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

export function IssuesPage() {
  const { t } = useTranslation();
  const search = useSearch({ from: '/issues' });
  const navigate = useNavigate({ from: '/issues' });
  const issues = useIssues();
  const all = issues.data ?? [];
  const focusIssue = search.focus ? all.find((i) => i.fingerprint === search.focus) : undefined;
  const view: View = search.view ?? (focusIssue ? viewOf(focusIssue) : 'open');
  const counts = { open: 0, muted: 0, resolved: 0 };
  for (const i of all) counts[viewOf(i)]++;
  const shown = all
    .filter((i) => viewOf(i) === view)
    .sort((a, b) =>
      view === 'resolved'
        ? 0
        : (SEVERITY_RANK[a.group.severity] ?? 3) - (SEVERITY_RANK[b.group.severity] ?? 3),
    );
  const services = shown.filter((i) => i.group.origin === 'service');
  const wardarr = shown.filter((i) => i.group.origin === 'wardarr');

  const tabs: View[] = ['open', 'muted', 'resolved'];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={t('ui.issues.eyebrow')}
        title={t('ui.issues.title')}
        actions={
          <div role="tablist" aria-label={t('ui.issues.title')} className="flex rounded-xl bg-surface-2 p-1">
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={view === id}
                onClick={() => void navigate({ search: { view: id === 'open' ? undefined : id } })}
                className={`relative rounded-lg px-3 py-1.5 text-sm font-medium ${view === id ? 'text-text' : 'text-muted hover:text-text'}`}
              >
                {view === id ? (
                  <motion.span
                    layoutId="issues-tab"
                    className="absolute inset-0 rounded-lg bg-surface shadow-sm"
                    transition={spring}
                  />
                ) : null}
                <span className="relative">
                  {t(`ui.issues.${id}`)} <span className="text-muted tabular-nums">{counts[id]}</span>
                </span>
              </button>
            ))}
          </div>
        }
      />

      {issues.data ? <IssuesHero issues={all} /> : null}

      {issues.isError ? (
        <InlineError
          message={t('ui.errors.loadFailed')}
          next={t('ui.errors.loadFailedNext')}
          onRetry={() => void issues.refetch()}
        />
      ) : null}
      {issues.isPending ? (
        <div className="flex flex-col gap-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-[var(--radius-card)]" />
          ))}
        </div>
      ) : null}

      {issues.data && shown.length === 0 ? (
        <Card>
          {view === 'open' ? (
            <EmptyState title={t('ui.issues.allClear')} body={t('ui.issues.allClearBody')} />
          ) : (
            <p className="py-6 text-center text-sm text-muted">
              {view === 'muted' ? t('ui.issues.noMuted') : t('ui.issues.noResolved')}
            </p>
          )}
        </Card>
      ) : null}

      {services.length > 0 ? (
        <section aria-label={t('ui.issues.servicesSection')} className="flex flex-col gap-3">
          {wardarr.length > 0 ? <SectionRule>{t('ui.issues.servicesSection')}</SectionRule> : null}
          <IssueList issues={services} focus={search.focus} />
        </section>
      ) : null}
      {wardarr.length > 0 ? (
        <section aria-label={t('ui.issues.wardarrSection')} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <SectionRule>{t('ui.issues.wardarrSection')}</SectionRule>
            <p className="text-xs text-muted">{t('ui.issues.wardarrSectionHint')}</p>
          </div>
          <IssueList issues={wardarr} focus={search.focus} />
        </section>
      ) : null}
    </div>
  );
}
