// "What's coming": the calendars of every Sonarr, Radarr, Lidarr and Readarr
// in one place. The hero counts the coming week, the strip below shows the
// next two weeks at a glance, and the list or month view has the details.
import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarFeedCard } from '../components/CalendarFeed';
import { LiveDot, SegmentBar, tint, useCalm } from '../components/charts';
import { Odometer, PageHeader, SectionRule } from '../components/dash';
import { Poster } from '../components/Poster';
import { ServiceLogo } from '../components/ServiceLogo';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  InlineError,
  Skeleton,
  Tabs,
  ViewTransition,
  spring,
} from '../components/ui';
import { api } from '../lib/api';
import {
  KINDS,
  KIND_SHADE,
  addDays,
  byDay,
  calendarUrl,
  dayKeyOf,
  dayStart,
  episodeCode,
  isMissing,
  itemDay,
  itemTime,
  startOfToday,
  type CalendarData,
  type CalendarItem,
  type CalendarKind,
} from '../lib/calendar';
import { formatDuration } from '../lib/format';

type View = 'agenda' | 'month';
const DAY = 86_400_000;

function useCalendar(start: Date, end: Date) {
  return useQuery({
    queryKey: ['calendar', start.toISOString(), end.toISOString()],
    queryFn: () => api<CalendarData>(calendarUrl(start, end)),
    refetchInterval: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
}

/** The current time, refreshed every half minute for countdowns. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function CalendarPage() {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const today = startOfToday(new Date(now));
  const todayKey = dayKeyOf(today);
  const [view, setView] = useState<View>('agenda');
  const [weeks, setWeeks] = useState(4);
  const [earlier, setEarlier] = useState(false);
  const [kinds, setKinds] = useState<Set<CalendarKind>>(() => new Set(KINDS));
  const [hideDownloaded, setHideDownloaded] = useState(false);
  const [focus, setFocus] = useState<{ day: string; at: number } | null>(null);

  // The list always loads the last week too: the hero counts what is missing.
  const listStart = addDays(today, -7);
  const listEnd = addDays(today, weeks * 7 + 1);
  const list = useCalendar(listStart, listEnd);

  const eyebrow = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(now));

  const header = <PageHeader eyebrow={eyebrow} title={t('calendar.title')} intro={t('calendar.intro')} />;

  if (list.isError && !list.data)
    return (
      <div className="flex flex-col gap-6">
        {header}
        <InlineError
          message={t('ui.errors.loadFailed')}
          next={t('ui.errors.loadFailedNext')}
          onRetry={() => void list.refetch()}
        />
      </div>
    );
  if (!list.data)
    return (
      <div className="flex flex-col gap-6" aria-busy>
        {header}
        <div className="grid gap-4 lg:grid-cols-5">
          <Skeleton className="h-56 rounded-[var(--radius-card)] lg:col-span-3" />
          <Skeleton className="h-56 rounded-[var(--radius-card)] lg:col-span-2" />
        </div>
        <Skeleton className="h-40 rounded-[var(--radius-card)]" />
      </div>
    );

  const { sources, items } = list.data;
  if (sources.length === 0)
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Card>
          <EmptyState title={t('calendar.empty.title')} body={t('calendar.empty.noSources')} />
        </Card>
        <CalendarFeedCard />
      </div>
    );

  const present = KINDS.filter((k) => items.some((i) => i.kind === k));
  const visible = (i: CalendarItem) => kinds.has(i.kind) && !(hideDownloaded && i.hasFile);
  const failing = sources.filter((s) => s.error);

  const pickDay = (key: string) => {
    setView('agenda');
    setFocus({ day: key, at: Date.now() });
  };

  return (
    <div className="flex flex-col gap-6">
      {header}
      {failing.map((s) => (
        <InlineError key={s.id} message={t('calendar.sourceError', { name: s.name })} />
      ))}

      <div className="grid gap-4 lg:grid-cols-5">
        <WeekHero items={items} now={now} today={today} />
        <NextUp items={items} now={now} today={today} />
      </div>

      <SectionRule>{t('calendar.strip.title')}</SectionRule>
      <DayStrip items={items} today={today} todayKey={todayKey} onPick={pickDay} />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Tabs
            label={t('calendar.title')}
            value={view}
            onChange={setView}
            options={[
              ['agenda', t('calendar.views.agenda')],
              ['month', t('calendar.views.month')],
            ]}
          />
          <Filters
            present={present}
            kinds={kinds}
            onKinds={setKinds}
            hideDownloaded={hideDownloaded}
            onHideDownloaded={setHideDownloaded}
          />
        </div>
        <ViewTransition view={view}>
          {view === 'agenda' ? (
            <Agenda
              items={items.filter(visible)}
              now={now}
              today={today}
              earlier={earlier}
              onEarlier={() => setEarlier((e) => !e)}
              canLoadMore={weeks < 8}
              onMore={() => setWeeks(8)}
              loadingMore={list.isFetching}
              focus={focus}
              filtered={items.length > 0}
            />
          ) : (
            <MonthView today={today} now={now} visible={visible} />
          )}
        </ViewTransition>
      </section>

      <CalendarFeedCard />
    </div>
  );
}

// -------------------------------------------------------------------- hero

function useCountList() {
  const { t, i18n } = useTranslation();
  return (items: CalendarItem[]) => {
    const parts = KINDS.map((k) => [k, items.filter((i) => i.kind === k).length] as const)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => t(`calendar.count.${k}`, { count: n }));
    return new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(parts);
  };
}

function WeekHero({ items, now, today }: { items: CalendarItem[]; now: number; today: Date }) {
  const { t } = useTranslation();
  const countList = useCountList();
  const weekEnd = addDays(today, 7).getTime();
  const todayEnd = addDays(today, 1).getTime();
  const week = items.filter((i) => itemTime(i) >= today.getTime() && itemTime(i) < weekEnd);
  const todays = week.filter((i) => itemTime(i) < todayEnd).length;
  const missing = items.filter((i) => isMissing(i, now) && itemTime(i) >= today.getTime() - 7 * DAY).length;

  const sentence =
    week.length === 0
      ? t('calendar.hero.quiet')
      : `${t('calendar.hero.week', { list: countList(week) })} ${
          todays > 0 ? t('calendar.hero.today', { count: todays }) : t('calendar.hero.todayNone')
        }`;

  return (
    <motion.div
      className="lg:col-span-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <Card as="div" className="flex h-full flex-col gap-4 sm:p-7">
        <div className="flex items-baseline gap-3">
          <span className="text-6xl leading-none font-bold tracking-tight">
            <Odometer text={String(week.length)} />
          </span>
          <span className="text-lg text-muted">{t('calendar.hero.label', { count: week.length })}</span>
        </div>
        <p className="text-base font-medium text-balance">{sentence}</p>
        {week.length > 0 ? (
          <SegmentBar
            tall
            label={t('calendar.hero.label', { count: week.length })}
            segments={KINDS.map((k) => ({
              key: k,
              label: t(`calendar.kinds.${k}`),
              value: week.filter((i) => i.kind === k).length,
              tone: 'accent' as const,
              shade: KIND_SHADE[k],
            }))}
          />
        ) : null}
        {missing > 0 ? (
          <p className="mt-auto flex items-center gap-2 text-sm">
            <Badge tone="warning">{t('calendar.entry.missing')}</Badge>
            {t('calendar.hero.missing', { count: missing })}
          </p>
        ) : null}
      </Card>
    </motion.div>
  );
}

function NextUp({ items, now, today }: { items: CalendarItem[]; now: number; today: Date }) {
  const { t, i18n } = useTranslation();
  // The next timed airing still to come (or running), or the next release day.
  const next = items.find((i) =>
    i.allDay ? itemTime(i) >= today.getTime() : itemTime(i) + (i.runtimeMinutes ?? 30) * 60_000 > now,
  );
  const airing = next && !next.allDay && itemTime(next) <= now;
  const after = next ? items.slice(items.indexOf(next) + 1, items.indexOf(next) + 4) : [];
  const timeOf = (i: CalendarItem) =>
    i.allDay
      ? dayLabel(itemDay(i), today, i18n.language, t)
      : `${dayLabel(itemDay(i), today, i18n.language, t)}, ${new Intl.DateTimeFormat(i18n.language, {
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(i.date))}`;
  const when = (() => {
    if (!next) return '';
    if (airing) return t('calendar.next.now');
    if (!next.allDay) {
      const secs = (itemTime(next) - now) / 1000;
      if (secs < 86_400) return t('calendar.next.in', { time: formatDuration(secs) });
    }
    return dayLabel(itemDay(next), today, i18n.language, t);
  })();

  return (
    <motion.div
      className="lg:col-span-2"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 0.05 }}
    >
      <Card as="div" className="flex h-full flex-col gap-4">
        <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          {t('calendar.next.title')}
        </span>
        {next ? (
          <div className="flex gap-4">
            <Thumb item={next} size="lg" />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                {airing ? <LiveDot tone="accent" label={t('calendar.next.now')} /> : null}
                {when}
              </span>
              <span className="truncate font-medium">{next.title}</span>
              <ItemDetail item={next} />
              <ItemTags item={next} now={now} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">{t('calendar.next.none')}</p>
        )}
        {after.length ? (
          <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
            <span className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
              {t('calendar.next.after')}
            </span>
            <ul className="flex flex-col gap-1.5">
              {after.map((i) => (
                <li key={i.key} className="flex items-center gap-2 text-sm">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: tint('accent', KIND_SHADE[i.kind] * 100) }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {i.title}
                    {episodeCode(i) ? <span className="text-muted"> · {episodeCode(i)}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">{timeOf(i)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </motion.div>
  );
}

// ------------------------------------------------------------------- strip

const STRIP_DAYS = 14;
const STRIP_MARKS = 5;

/**
 * The next two weeks as a row of days. Each release is a small mark,
 * shaded by kind; a day with more shows "+n". Today carries a live dot.
 */
function DayStrip({
  items,
  today,
  todayKey,
  onPick,
}: {
  items: CalendarItem[];
  today: Date;
  todayKey: string;
  onPick: (day: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const calm = useCalm();
  const countList = useCountList();
  const days = byDay(items);
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' });
  const long = new Intl.DateTimeFormat(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <Card className="p-3 sm:p-4">
      <ol
        className="grid grid-cols-7 gap-1.5 sm:gap-2 lg:grid-cols-14"
        aria-label={t('calendar.strip.label')}
      >
        {Array.from({ length: STRIP_DAYS }, (_, i) => {
          const date = addDays(today, i);
          const key = dayKeyOf(date);
          const list = days.get(key) ?? [];
          const isToday = key === todayKey;
          const weekend = date.getDay() === 0 || date.getDay() === 6;
          const name = long.format(date);
          const aria = list.length
            ? t('calendar.strip.day', { day: name, list: countList(list) })
            : t('calendar.strip.empty', { day: name });
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => onPick(key)}
                aria-label={aria}
                title={aria}
                className={`flex h-full min-h-28 w-full flex-col items-center gap-1 rounded-xl px-1 pt-2 pb-2.5 transition-colors hover:bg-surface-2 ${
                  isToday ? 'bg-surface-2 ring-2 ring-accent' : ''
                }`}
              >
                <span
                  className={`text-[10px] font-semibold tracking-wider uppercase ${weekend ? 'text-text' : 'text-muted'}`}
                >
                  {weekday.format(date)}
                </span>
                <span className="flex items-center gap-1 text-lg leading-none font-semibold tabular-nums">
                  {date.getDate()}
                </span>
                <span className="flex h-3 items-center">
                  {isToday ? <LiveDot tone="accent" label={t('calendar.day.today')} /> : null}
                </span>
                <span className="mt-auto flex w-full flex-col-reverse items-center gap-[3px]">
                  {list.slice(0, STRIP_MARKS).map((item, j) => (
                    <motion.span
                      key={item.key}
                      className="h-2 w-full max-w-7 rounded-[3px]"
                      style={{ background: tint('accent', KIND_SHADE[item.kind] * 100) }}
                      initial={calm ? false : { scaleX: 0, opacity: 0 }}
                      animate={{ scaleX: 1, opacity: 1 }}
                      transition={{ ...spring, delay: 0.12 + i * 0.03 + j * 0.04 }}
                    />
                  ))}
                  {list.length > STRIP_MARKS ? (
                    <span className="text-[10px] font-semibold text-muted tabular-nums">
                      +{list.length - STRIP_MARKS}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <KindLegend className="mt-3 px-1" />
    </Card>
  );
}

function KindLegend({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted ${className}`}>
      {KINDS.map((k) => (
        <li key={k} className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-sm"
            style={{ background: tint('accent', KIND_SHADE[k] * 100) }}
            aria-hidden
          />
          {t(`calendar.kinds.${k}`)}
        </li>
      ))}
    </ul>
  );
}

// ----------------------------------------------------------------- filters

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
        pressed ? 'border-accent bg-surface-2 text-text' : 'border-border text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  );
}

function Filters({
  present,
  kinds,
  onKinds,
  hideDownloaded,
  onHideDownloaded,
}: {
  present: CalendarKind[];
  kinds: Set<CalendarKind>;
  onKinds: (k: Set<CalendarKind>) => void;
  hideDownloaded: boolean;
  onHideDownloaded: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const toggle = (k: CalendarKind) => {
    const next = new Set(kinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onKinds(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('calendar.filters.label')}>
      {present.length > 1
        ? present.map((k) => (
            <Chip key={k} pressed={kinds.has(k)} onClick={() => toggle(k)}>
              <KindIcon kind={k} className="size-4" />
              {t(`calendar.kinds.${k}`)}
            </Chip>
          ))
        : null}
      <Chip pressed={hideDownloaded} onClick={() => onHideDownloaded(!hideDownloaded)}>
        {t('calendar.filters.hideDownloaded')}
      </Chip>
    </div>
  );
}

// ------------------------------------------------------------------ agenda

type T = ReturnType<typeof useTranslation>['t'];

function dayLabel(key: string, today: Date, lang: string, t: T): string {
  const diff = Math.round((dayStart(key).getTime() - today.getTime()) / DAY);
  if (diff === 0) return t('calendar.day.today');
  if (diff === 1) return t('calendar.day.tomorrow');
  if (diff === -1) return t('calendar.day.yesterday');
  return new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(
    dayStart(key),
  );
}

function Agenda({
  items,
  now,
  today,
  earlier,
  onEarlier,
  canLoadMore,
  onMore,
  loadingMore,
  focus,
  filtered,
}: {
  items: CalendarItem[];
  now: number;
  today: Date;
  earlier: boolean;
  onEarlier: () => void;
  canLoadMore: boolean;
  onMore: () => void;
  loadingMore: boolean;
  focus: { day: string; at: number } | null;
  filtered: boolean;
}) {
  const { t } = useTranslation();
  const shown = earlier ? items : items.filter((i) => itemDay(i) >= dayKeyOf(today));
  const days = [...byDay(shown).entries()];
  useEffect(() => {
    if (!focus) return;
    // The picked day, or the next day that has something.
    const sections = [...document.querySelectorAll<HTMLElement>('[data-calendar-day]')];
    const el = sections.find((x) => (x.dataset.calendarDay ?? '') >= focus.day);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" onClick={onEarlier}>
          {earlier ? t('calendar.agenda.hideEarlier') : t('calendar.agenda.earlier')}
        </Button>
      </div>
      {days.length === 0 ? (
        <Card>
          <EmptyState
            title={t('calendar.empty.title')}
            body={filtered ? t('calendar.empty.filtered') : t('calendar.empty.body')}
          />
        </Card>
      ) : (
        days.map(([key, list]) => (
          <section key={key} data-calendar-day={key} className="scroll-mt-20">
            <DayList dayKey={key} items={list} today={today} now={now} highlight={key === focus?.day} />
          </section>
        ))
      )}
      {canLoadMore ? (
        <div className="flex justify-center">
          <Button onClick={onMore} busy={loadingMore}>
            {t('calendar.agenda.later')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DayList({
  dayKey,
  items,
  today,
  now,
  highlight = false,
}: {
  dayKey: string;
  items: CalendarItem[];
  today: Date;
  now: number;
  highlight?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const calm = useCalm();
  const isToday = dayKey === dayKeyOf(today);
  const past = dayKey < dayKeyOf(today);
  return (
    <Card className={`p-0 ${highlight ? 'ring-2 ring-accent' : ''}`}>
      <h3 className="flex items-baseline gap-3 border-b border-border px-5 py-3">
        <span className={`font-semibold ${isToday ? 'text-accent' : past ? 'text-muted' : ''}`}>
          {dayLabel(dayKey, today, i18n.language, t)}
        </span>
        {isToday || Math.abs(dayStart(dayKey).getTime() - today.getTime()) < 2 * DAY ? (
          <span className="text-xs text-muted">
            {new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'long' }).format(
              dayStart(dayKey),
            )}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-muted tabular-nums">{items.length}</span>
      </h3>
      <ul className="divide-y divide-border">
        {items.map((item, i) => (
          <motion.li
            key={item.key}
            initial={calm ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: Math.min(i, 8) * 0.04 }}
            className="flex gap-4 px-5 py-3"
          >
            <Thumb item={item} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="min-w-0 truncate font-medium">{item.title}</span>
                <span className="shrink-0 text-sm text-muted tabular-nums">
                  {item.allDay
                    ? t(`calendar.release.${item.release}`)
                    : new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(
                        new Date(item.date),
                      )}
                </span>
              </div>
              <ItemDetail item={item} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <ItemTags item={item} now={now} />
                <Sources item={item} />
              </div>
            </div>
          </motion.li>
        ))}
      </ul>
    </Card>
  );
}

function ItemDetail({ item }: { item: CalendarItem }) {
  const { t } = useTranslation();
  const code = episodeCode(item);
  const parts =
    item.kind === 'episode'
      ? [code, item.subtitle]
      : item.kind === 'movie'
        ? [item.year ? String(item.year) : null, item.network]
        : [item.subtitle, item.network];
  const runtime = item.runtimeMinutes ? t('calendar.entry.minutes', { count: item.runtimeMinutes }) : null;
  const text = [...parts, runtime].filter(Boolean).join(' · ');
  return text ? <span className="truncate text-sm text-muted">{text}</span> : null;
}

function ItemTags({ item, now }: { item: CalendarItem; now: number }) {
  const { t } = useTranslation();
  const tags: ReactNode[] = [];
  if (item.premiere)
    tags.push(
      <Pill key="p" strong>
        {t(`calendar.premiere.${item.premiere}`)}
      </Pill>,
    );
  if (item.finale)
    tags.push(
      <Pill key="f" strong>
        {t(`calendar.finale.${item.finale}`)}
      </Pill>,
    );
  if (item.kind === 'movie') tags.push(<Pill key="r">{t(`calendar.release.${item.release}`)}</Pill>);
  if (item.hasFile)
    tags.push(
      <Badge key="d" tone="ok">
        <CheckIcon />
        {t('calendar.entry.downloaded')}
      </Badge>,
    );
  else if (isMissing(item, now))
    tags.push(
      <Badge key="m" tone="warning">
        {t('calendar.entry.missing')}
      </Badge>,
    );
  return tags.length ? <span className="flex flex-wrap items-center gap-1.5">{tags}</span> : null;
}

/** A label that is not a status: accent tinted, or plain. */
function Pill({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${strong ? 'text-accent' : 'bg-surface-2 text-muted'}`}
      style={strong ? { background: tint('accent', 14) } : undefined}
    >
      {children}
    </span>
  );
}

function Sources({ item }: { item: CalendarItem }) {
  const { t } = useTranslation();
  const names = item.instances.map((i) => i.name).join(', ');
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted"
      title={t('calendar.entry.from', { instances: names })}
    >
      <span className="flex -space-x-1">
        {item.instances.map((i) => (
          <ServiceLogo key={i.id} adapter={i.adapter} name={i.name} size={16} />
        ))}
      </span>
      <span className="max-w-40 truncate">{names}</span>
    </span>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const KIND_ICON: Record<CalendarKind, string> = {
  episode: 'M3 6.5h18v11H3zM8.5 21h7M12 17.5V21',
  movie: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4',
  album: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 6.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  book: 'M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5zM5 20.5A2.5 2.5 0 0 1 7.5 18H19v3H7.5',
};

function KindIcon({ kind, className = 'size-5' }: { kind: CalendarKind; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
    >
      <path d={KIND_ICON[kind]} />
    </svg>
  );
}

/** Poster when TMDB has one, otherwise a tile with the kind's icon. */
function Thumb({ item, size = 'sm' }: { item: CalendarItem; size?: 'sm' | 'lg' }) {
  const width = size === 'lg' ? 'w-20' : 'w-11';
  if (item.posterPath)
    return <Poster path={item.posterPath} title={item.title} size="w185" className={`${width} shrink-0`} />;
  return (
    <span
      className={`${width} grid aspect-[2/3] shrink-0 place-items-center rounded-xl text-accent`}
      style={{ background: tint('accent', 12) }}
      aria-hidden
    >
      <KindIcon kind={item.kind} className={size === 'lg' ? 'size-8' : 'size-5'} />
    </span>
  );
}

// ------------------------------------------------------------------- month

function firstWeekday(lang: string): number {
  try {
    const info = (new Intl.Locale(lang) as Intl.Locale & { weekInfo?: { firstDay: number } }).weekInfo;
    if (info) return info.firstDay % 7;
  } catch {
    // Older browsers: weeks start on Monday.
  }
  return 1;
}

function MonthView({
  today,
  now,
  visible,
}: {
  today: Date;
  now: number;
  visible: (i: CalendarItem) => boolean;
}) {
  const { t, i18n } = useTranslation();
  const calm = useCalm();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string>(dayKeyOf(today));
  const month = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const first = firstWeekday(i18n.language);
  const gridStart = addDays(month, -((month.getDay() - first + 7) % 7));
  const gridEnd = addDays(gridStart, 42);
  const data = useCalendar(gridStart, gridEnd);
  const days = useMemo(() => byDay((data.data?.items ?? []).filter(visible)), [data.data, visible]);
  const todayKey = dayKeyOf(today);
  const weekday = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' });
  const title = new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(month);
  const selectedItems = days.get(selected) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-3 sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-lg font-semibold capitalize">{title}</h3>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              aria-label={t('calendar.month.previous')}
              onClick={() => setOffset(offset - 1)}
            >
              ‹
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setOffset(0);
                setSelected(todayKey);
              }}
            >
              {t('calendar.month.today')}
            </Button>
            <Button
              variant="ghost"
              aria-label={t('calendar.month.next')}
              onClick={() => setOffset(offset + 1)}
            >
              ›
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold tracking-wider text-muted uppercase">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i}>{weekday.format(addDays(gridStart, i))}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1" aria-busy={data.isFetching}>
          {Array.from({ length: 42 }, (_, i) => {
            const date = addDays(gridStart, i);
            const key = dayKeyOf(date);
            const list = days.get(key) ?? [];
            const inMonth = date.getMonth() === month.getMonth();
            const isSelected = key === selected;
            return (
              <motion.button
                key={`${month.getTime()}-${key}`}
                type="button"
                onClick={() => setSelected(key)}
                aria-pressed={isSelected}
                aria-label={`${new Intl.DateTimeFormat(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' }).format(date)}: ${list.length}`}
                initial={calm ? false : { scale: 0.92 }}
                animate={{ scale: 1 }}
                transition={{ ...spring, delay: (Math.floor(i / 7) + (i % 7)) * 0.008 }}
                className={`flex min-h-16 flex-col gap-1 rounded-lg p-1.5 text-left transition-colors sm:min-h-24 ${
                  isSelected ? 'bg-surface-2 ring-2 ring-accent' : 'hover:bg-surface-2'
                } ${inMonth ? '' : 'text-muted'}`}
              >
                <span
                  className={`inline-grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums ${
                    key === todayKey ? 'bg-accent text-accent-contrast' : ''
                  }`}
                >
                  {date.getDate()}
                </span>
                {/* Phones: one mark per release. Wider screens: the first titles. */}
                <span className="flex flex-wrap gap-0.5 sm:hidden">
                  {list.slice(0, 6).map((item) => (
                    <span
                      key={item.key}
                      className="size-1.5 rounded-full"
                      style={{ background: tint('accent', KIND_SHADE[item.kind] * 100) }}
                    />
                  ))}
                </span>
                <span className="hidden w-full flex-col gap-0.5 sm:flex">
                  {list.slice(0, 3).map((item) => (
                    <span
                      key={item.key}
                      className="truncate rounded py-px pr-1 pl-1.5 text-[11px] leading-tight text-text"
                      style={{
                        background: tint('accent', KIND_SHADE[item.kind] * 22),
                        boxShadow: `inset 3px 0 0 ${tint('accent', KIND_SHADE[item.kind] * 100)}`,
                      }}
                    >
                      {item.title}
                    </span>
                  ))}
                  {list.length > 3 ? (
                    <span className="px-1 text-[10px] text-muted">
                      {t('calendar.month.more', { count: list.length - 3 })}
                    </span>
                  ) : null}
                </span>
              </motion.button>
            );
          })}
        </div>
        <KindLegend className="mt-3 px-1" />
      </Card>
      {selectedItems.length ? (
        <DayList dayKey={selected} items={selectedItems} today={today} now={now} />
      ) : (
        <p className="px-1 text-sm text-muted">{t('calendar.month.nothing')}</p>
      )}
    </div>
  );
}
