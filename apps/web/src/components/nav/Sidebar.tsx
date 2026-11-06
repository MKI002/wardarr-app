// The desktop navigation: a left sidebar with the pages in sections. It folds
// to an icon rail, and each section folds on its own; both are remembered in
// this browser.
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Guardian, spring, type Tone } from '../ui';
import { NavIcon, groupTabs, isActive, pathOf, type GroupId } from './model';
import { isApple, useStored, type NavBadge } from './state';

const BADGE_TONE: Record<Tone, string> = {
  critical: 'bg-critical-bg text-critical',
  warning: 'bg-warning-bg text-warning',
  info: 'bg-info-bg text-info',
  ok: 'bg-ok-bg text-ok',
  neutral: 'bg-surface-2 text-muted',
};
const DOT_TONE: Record<Tone, string> = {
  critical: 'bg-critical',
  warning: 'bg-warning-mark',
  info: 'bg-info',
  ok: 'bg-ok',
  neutral: 'bg-muted',
};

/** Shown beside an icon in the rail, where the label is hidden. */
function RailTip({ children }: { children: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-full z-50 ml-3 hidden -translate-y-1/2 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium whitespace-nowrap text-text shadow-lg group-hover:block group-focus-visible:block"
    >
      {children}
    </span>
  );
}

function NavItem({
  id,
  pathname,
  rail,
  badge,
}: {
  id: string;
  pathname: string;
  rail: boolean;
  badge?: NavBadge;
}) {
  const { t } = useTranslation();
  const descId = useId();
  const active = isActive(id, pathname);
  const label = t(`ui.tabs.${id}`);
  const ref = useRef<HTMLLIElement>(null);
  // On short screens the list scrolls: keep the current page in view.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <li ref={ref} className="relative">
      <Link
        to={pathOf(id)}
        aria-current={active ? 'page' : undefined}
        aria-describedby={badge ? descId : undefined}
        className={`group relative flex h-9 items-center [@media(max-height:820px)]:h-8 gap-3 rounded-lg text-sm font-medium transition-colors ${rail ? 'justify-center px-0' : 'px-3'} ${active ? 'text-text' : 'text-muted hover:bg-surface-2/60 hover:text-text'}`}
      >
        {active ? (
          <motion.span
            layoutId="nav-pill"
            className="absolute inset-0 rounded-lg bg-surface-2"
            transition={spring}
          >
            <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-accent" />
          </motion.span>
        ) : null}
        <span className="relative">
          <NavIcon id={id} className={`size-5 ${active ? 'text-accent' : ''}`} />
          {rail && badge ? (
            <span
              aria-hidden
              className={`absolute -top-1 -right-1 size-2.5 rounded-full ring-2 ring-bg ${DOT_TONE[badge.tone]}`}
            />
          ) : null}
        </span>
        <span className={rail ? 'sr-only' : 'relative truncate'}>{label}</span>
        {!rail && badge ? (
          <span
            aria-hidden
            className={`relative ml-auto min-w-6 rounded-full px-1.5 text-center text-xs leading-5 font-semibold tabular-nums ${BADGE_TONE[badge.tone]}`}
          >
            {badge.count}
          </span>
        ) : null}
        {rail ? <RailTip>{badge ? `${label} · ${badge.count}` : label}</RailTip> : null}
      </Link>
      {badge ? (
        <span id={descId} className="sr-only">
          {t(`ui.nav.badge.${id}`, { count: badge.count, defaultValue: String(badge.count) })}
        </span>
      ) : null}
    </li>
  );
}

export function AccountMenu({ rail = false, side = 'top' }: { rail?: boolean; side?: 'top' | 'bottom' }) {
  const { t } = useTranslation();
  const { me, logout } = useAccount();
  const name = me.displayName ?? me.username;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={`group relative flex items-center gap-3 rounded-lg text-left text-sm outline-none hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-accent ${rail ? 'size-9 justify-center' : side === 'top' ? 'h-11 w-full px-2' : ''}`}
        aria-label={t('ui.nav.account')}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold uppercase">
          {name.slice(0, 1)}
        </span>
        {!rail && side === 'top' ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{name}</span>
            <span className="block text-xs text-muted">
              {me.role === 'admin' ? t('ui.settings.roleAdmin') : t('ui.settings.roleUser')}
            </span>
          </span>
        ) : null}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side={side}
          align={side === 'top' ? 'start' : 'end'}
          sideOffset={6}
          className="z-50 min-w-48 rounded-xl border border-border bg-surface p-1 shadow-lg"
        >
          <div className="px-3 py-2 text-xs text-muted">{name}</div>
          <DropdownMenu.Item asChild>
            <Link
              to="/settings"
              search={{ section: 'appearance' }}
              className="block rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2"
            >
              {t('ui.settings.appearance')}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onSelect={() => void logout()}
            className="cursor-pointer rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-surface-2"
          >
            {t('ui.nav.logout')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function useAccount() {
  const { me } = useSession();
  const client = useQueryClient();
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    client.clear();
    window.location.assign(import.meta.env.BASE_URL);
  };
  return { me, logout };
}

export function SearchButton({ rail, onClick }: { rail: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  const keys = isApple() ? '⌘K' : t('ui.nav.ctrlK');
  return (
    <button
      type="button"
      onClick={onClick}
      aria-keyshortcuts="Meta+K Control+K"
      className={`group relative flex h-9 items-center gap-3 rounded-lg border border-border bg-surface/70 text-sm text-muted transition-colors hover:border-accent/40 hover:text-text ${rail ? 'w-9 justify-center' : 'w-full px-3'}`}
    >
      <NavIcon id="search" className="size-4" />
      <span className={rail ? 'sr-only' : ''}>{t('ui.nav.search')}</span>
      {!rail ? (
        <kbd className="ml-auto rounded-md border border-border px-1.5 font-sans text-[11px] leading-5 text-muted">
          {keys}
        </kbd>
      ) : (
        <RailTip>{`${t('ui.nav.search')} · ${keys}`}</RailTip>
      )}
    </button>
  );
}

export function Sidebar({
  tabs,
  pathname,
  rail,
  onRail,
  onSearch,
  badges,
}: {
  tabs: string[];
  pathname: string;
  rail: boolean;
  onRail: (rail: boolean) => void;
  onSearch: () => void;
  badges: Record<string, NavBadge | undefined>;
}) {
  const { t } = useTranslation();
  const groups = groupTabs(tabs);
  const [folded, setFolded] = useStored<GroupId[]>('wardarr.nav.folded', []);
  const toggleGroup = (id: GroupId) =>
    setFolded(folded.includes(id) ? folded.filter((g) => g !== id) : [...folded, id]);

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-bg/80 backdrop-blur transition-[width] duration-200 ease-out lg:flex ${rail ? 'w-[4.5rem]' : 'w-60'}`}
    >
      <div
        className={`flex h-16 shrink-0 items-center ${rail ? 'justify-center' : 'justify-between pr-3 pl-5'}`}
      >
        <Link
          to="/"
          aria-label={t('ui.nav.home')}
          className="inline-flex items-center gap-2 font-semibold tracking-tight"
        >
          <Guardian size={28} />
          {!rail ? <span className="text-lg">Wardarr</span> : null}
        </Link>
        {!rail ? (
          <button
            type="button"
            onClick={() => onRail(true)}
            className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
            aria-label={t('ui.nav.collapse')}
            title={t('ui.nav.collapse')}
          >
            <NavIcon id="rail" className="size-[18px]" />
          </button>
        ) : null}
      </div>

      <div className={`shrink-0 pb-3 ${rail ? 'flex justify-center' : 'px-3'}`}>
        <SearchButton rail={rail} onClick={onSearch} />
      </div>

      <nav aria-label={t('ui.nav.main')} className="flex min-h-0 flex-1 flex-col">
        {/* The rail keeps overflow visible so its tooltips are not clipped. */}
        <div className={`min-h-0 flex-1 px-3 pb-3 ${rail ? '' : 'overflow-y-auto'}`}>
          {groups.map((g, i) => {
            const isFolded = !rail && folded.includes(g.id);
            const visible = isFolded ? g.tabs.filter((id) => isActive(id, pathname)) : g.tabs;
            return (
              <div key={g.id} className={i ? 'mt-4 [@media(max-height:820px)]:mt-2.5' : ''}>
                {rail ? (
                  i ? (
                    <div className="mx-2 mb-3 h-px bg-border" aria-hidden />
                  ) : null
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.id)}
                    aria-expanded={!isFolded}
                    className="group flex w-full items-center gap-1 px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase hover:text-text"
                  >
                    <span>{t(`ui.nav.groups.${g.id}`)}</span>
                    <span
                      className={`ml-auto opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 ${isFolded ? '' : 'rotate-90'}`}
                    >
                      <NavIcon id="chevron" className="size-3.5" />
                    </span>
                  </button>
                )}
                <ul className="flex flex-col gap-0.5">
                  {visible.map((id) => (
                    <NavItem key={id} id={id} pathname={pathname} rail={rail} badge={badges[id]} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        {tabs.includes('settings') ? (
          <ul className="shrink-0 border-t border-border px-3 pt-3">
            <NavItem id="settings" pathname={pathname} rail={rail} />
          </ul>
        ) : null}
      </nav>

      <div className={`flex shrink-0 flex-col gap-1 px-3 pt-1 pb-3 ${rail ? 'items-center' : ''}`}>
        <AccountMenu rail={rail} />
        {rail ? (
          <button
            type="button"
            onClick={() => onRail(false)}
            className="group relative flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text"
            aria-label={t('ui.nav.expand')}
          >
            <NavIcon id="rail" className="size-[18px]" />
            <RailTip>{t('ui.nav.expand')}</RailTip>
          </button>
        ) : null}
      </div>
    </aside>
  );
}
