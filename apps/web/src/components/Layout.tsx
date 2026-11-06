import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Logo } from './ui';

const TAB_PATHS: Record<string, string> = {
  overview: '/',
  issues: '/issues',
  cleaner: '/cleaner',
  hunting: '/hunting',
  settings: '/settings',
};

const ICONS: Record<string, string> = {
  overview: 'M3 12h7V3H3zm0 9h7v-7H3zm11 0h7v-9h-7zm0-18v7h7V3z',
  issues: 'M12 3 2 20h20zm0 6v5m0 3h.01',
  cleaner: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  hunting: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4M11 8v6M8 11h6',
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeTab = (id: string) =>
    TAB_PATHS[id] === '/' ? pathname === '/' : pathname.startsWith(TAB_PATHS[id] ?? '#');

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    client.clear();
    window.location.assign('/');
  };

  return (
    <div className="min-h-dvh pb-20 md:pb-0">
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
          <nav aria-label={t('ui.nav.main')} className="hidden md:block">
            <ul className="flex items-center gap-1">
              {tabs.map((id) => (
                <li key={id} className="relative">
                  <Link
                    to={TAB_PATHS[id] ?? '/'}
                    className={`relative z-10 block rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${activeTab(id) ? 'text-text' : 'text-muted hover:text-text'}`}
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
          <div className="ml-auto">
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
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={pathname.split('/')[1] ?? ''}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      <nav
        aria-label={t('ui.nav.main')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="flex justify-around">
          {tabs.map((id) => (
            <li key={id}>
              <Link
                to={TAB_PATHS[id] ?? '/'}
                className={`flex min-w-16 flex-col items-center gap-0.5 px-3 py-2 text-xs ${activeTab(id) ? 'text-accent' : 'text-muted'}`}
                aria-current={activeTab(id) ? 'page' : undefined}
              >
                <TabIcon id={id} />
                {t(`ui.tabs.${id}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
