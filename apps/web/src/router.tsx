import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { Root } from './components/Root';
import { IssuesPage } from './pages/Issues';
import { OverviewPage } from './pages/Overview';
import { CleanerPage } from './pages/Cleaner';
import { HuntingPage } from './pages/Hunting';
import { SettingsPage } from './pages/Settings';

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Root });

const overviewRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: OverviewPage });
const issuesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/issues',
  validateSearch: (s: Record<string, unknown>): { view?: 'open' | 'muted' | 'resolved'; focus?: string } => ({
    view: s.view === 'muted' || s.view === 'resolved' ? s.view : undefined,
    focus: typeof s.focus === 'string' ? s.focus : undefined,
  }),
  component: IssuesPage,
});
type CleanerTab = 'preview' | 'history' | 'attempts' | 'orphans' | 'settings';
const CLEANER_TABS = new Set(['preview', 'history', 'attempts', 'orphans', 'settings']);
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

const cleanerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/cleaner',
  validateSearch: (
    s: Record<string, unknown>,
  ): { instance?: string; tab?: CleanerTab; review?: string; client?: string } => ({
    instance: str(s.instance),
    tab: CLEANER_TABS.has(String(s.tab)) ? (s.tab as CleanerTab) : undefined,
    review: str(s.review),
    client: str(s.client),
  }),
  component: CleanerPage,
});
const huntingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/hunting',
  validateSearch: (s: Record<string, unknown>): { instance?: string } => ({ instance: str(s.instance) }),
  component: HuntingPage,
});
/** The read-only queue of stage 1 became the Queue Cleaner. */
const queueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/queue',
  beforeLoad: ({ search }) => {
    const instance = str((search as Record<string, unknown>).instance);
    throw redirect({ to: '/cleaner', search: { instance } });
  },
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  validateSearch: (s: Record<string, unknown>): { section?: 'instances' | 'users' | 'appearance' } => ({
    section:
      s.section === 'users' || s.section === 'appearance' || s.section === 'instances'
        ? s.section
        : undefined,
  }),
  component: SettingsPage,
});

const settingsInstanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/instances/$id',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  overviewRoute,
  issuesRoute,
  cleanerRoute,
  huntingRoute,
  queueRoute,
  settingsRoute,
  settingsInstanceRoute,
]);

export const router = createRouter({
  routeTree,
  context: { queryClient: undefined as unknown as QueryClient },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
