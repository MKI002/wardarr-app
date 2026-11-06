import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Logo, ViewTransition } from './ui';

const TAB_PATHS: Record<string, string> = {
  overview: '/',
  issues: '/issues',
  cleaner: '/cleaner',
  hunting: '/hunting',
  discover: '/discover',
  requests: '/requests',
  library: '/library',
  calendar: '/calendar',
  indexers: '/indexers',
  trash: '/trash',
  tdarr: '/tdarr',
  map: '/map',
  storage: '/storage',
  settings: '/settings',
};

const ICONS: Record<string, string> = {
  overview: 'M3 12h7V3H3zm0 9h7v-7H3zm11 0h7v-9h-7zm0-18v7h7V3z',
  issues: 'M12 3 2 20h20zm0 6v5m0 3h.01',
  cleaner: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  hunting: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4M11 8v6M8 11h6',
  discover: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm3.5 5.5-2 5-5 2 2-5z',
  requests: 'M8 4h8l1 3H7zM5 7h14v13H5zM9 12h6M9 16h4',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-1 2 15.5-3.5 1z',
  indexers: 'M4 6h16M4 12h16M4 18h10M18 16l2 2-2 2',
  calendar: 'M4 6.5h16V20H4zM4 10.5h16M8.5 3.5v5M15.5 3.5v5M8 14.5h3v3H8z',
  trash: 'M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6zM8.5 12l2.5 2.5 4.5-5',
  tdarr: 'M4 9a8 8 0 0 1 14.5-3.5M20 4v4h-4M20 15a8 8 0 0 1-14.5 3.5M4 20v-4h4M10 9.5v5l4-2.5z',
  map: 'M3 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M10 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 6h10M6 7.7l5 8.6M18 7.7l-5 8.6',
  storage:
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.5 4a8.5 8.5 0 0 0-.2-1.8l2-1.6-2-3.4-2.4 1a8 8 0 0 0-3-1.8L14.5 2h-5l-.4 2.4a8 8 0 0 0-3 1.8l-2.4-1-2 3.4 2 1.6a8.5 8.5 0 0 0 0 3.6l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 3 1.8l.4 2.4h5l.4-2.4a8 8 0 0 0 3-1.8l2.4 1 2-3.4-2-1.6c.1-.6.2-1.2.2-1.8z',
};

function TabIcon({ id }: { id: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
    >
      <path d={ICONS[id] ?? ''} />
    </svg>
  );
}

export function useTabs() {
  return useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api<{ tabs: string[] }>('/api/capabilities'),
  });
}

export function Layout() {
  const { t } = useTranslation();
  const { me } = useSession();
  const client = useQueryClient();
  const tabs = useTabs().data?.tabs ?? [];
  // The bottom bar holds four tabs; the rest go under "More".
  const primary = tabs.length > 5 ? tabs.slice(0, 4) : tabs;
  const overflow = tabs.length > 5 ? tabs.slice(4) : [];
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeTab = (id: string) =>
    TAB_PATHS[id] === '/' ? pathname === '/' : pathname.startsWith(TAB_PATHS[id] ?? '#');

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    client.clear();
    window.location.assign(import.meta.env.BASE_URL);
  };

  return (
    <div className="min-h-dvh pb-20 lg:pb-0">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
      >
        {t('ui.nav.skip')}
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link to="/" aria-label={t('ui.nav.home')}>
            <Logo />
          </Link>
          <nav
            aria-label={t('ui.nav.main')}
            className="hidden min-w-0 overflow-x-auto [scrollbar-width:thin] lg:block"
          >
            <ul className="flex items-center gap-1">
              {tabs.map((id) => (
                <li key={id} className="relative shrink-0">
                  <Link
                    to={TAB_PATHS[id] ?? '/'}
                    className={`relative z-10 block rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors xl:px-3 ${activeTab(id) ? 'text-text' : 'text-muted hover:text-text'}`}
                    aria-current={activeTab(id) ? 'page' : undefined}
                  >
                    {t(`ui.tabs.${id}`)}
                  </Link>
                  {activeTab(id) ? (
                    <motion.span
                      layoutId="tab-pill"
                      className="absolute inset-0 rounded-lg bg-surface-2"
                      transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto shrink-0">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                className="flex size-9 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold uppercase"
                aria-label={t('ui.nav.account')}
              >
                {(me.displayName ?? me.username).slice(0, 1)}
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={6}
                  className="z-50 min-w-48 rounded-xl border border-border bg-surface p-1 shadow-lg"
                >
                  <div className="px-3 py-2 text-xs text-muted">{me.displayName ?? me.username}</div>
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
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 py-6">
        <ViewTransition view={pathname.split('/')[1] ?? ''}>
          <Outlet />
        </ViewTransition>
      </main>

      <nav
        aria-label={t('ui.nav.main')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="flex justify-around">
          {primary.map((id) => (
            <li key={id}>
              <Link
                to={TAB_PATHS[id] ?? '/'}
                className={`flex min-w-16 flex-col items-center gap-0.5 px-2 py-2 text-xs ${activeTab(id) ? 'text-accent' : 'text-muted'}`}
                aria-current={activeTab(id) ? 'page' : undefined}
              >
                <TabIcon id={id} />
                {t(`ui.tabs.${id}`)}
              </Link>
            </li>
          ))}
          {overflow.length ? (
            <li>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger
                  className={`flex min-w-16 flex-col items-center gap-0.5 px-2 py-2 text-xs ${overflow.some(activeTab) ? 'text-accent' : 'text-muted'}`}
                >
                  <TabIcon id="more" />
                  {t('ui.nav.more')}
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    side="top"
                    align="end"
                    sideOffset={8}
                    className="z-50 min-w-48 rounded-xl border border-border bg-surface p-1 shadow-lg"
                  >
                    {overflow.map((id) => (
                      <DropdownMenu.Item key={id} asChild>
                        <Link
                          to={TAB_PATHS[id] ?? '/'}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-none data-[highlighted]:bg-surface-2 ${activeTab(id) ? 'text-accent' : ''}`}
                          aria-current={activeTab(id) ? 'page' : undefined}
                        >
                          <TabIcon id={id} />
                          {t(`ui.tabs.${id}`)}
                        </Link>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </li>
          ) : null}
        </ul>
      </nav>
    </div>
  );
}
