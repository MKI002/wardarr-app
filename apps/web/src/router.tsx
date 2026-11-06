import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter } from '@tanstack/react-router';
import { Root } from './components/Root';
import { IssuesPage } from './pages/Issues';
import { OverviewPage } from './pages/Overview';
import { QueuePage } from './pages/Queue';
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
const queueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/queue',
  validateSearch: (s: Record<string, unknown>): { instance?: string } => ({
    instance: typeof s.instance === 'string' ? s.instance : undefined,
  }),
  component: QueuePage,
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
