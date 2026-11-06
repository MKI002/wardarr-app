// The app shell: sidebar on wide screens, top and bottom bar on phones, the
// command palette everywhere, and the current page in between.
import { Outlet, useRouterState } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CommandPalette } from './nav/CommandPalette';
import { BottomBar, MobileHeader } from './nav/MobileNav';
import { Sidebar } from './nav/Sidebar';
import { useCapabilityTabs, useNavBadges, usePaletteShortcut, useStored } from './nav/state';
import { ViewTransition } from './ui';

export { useCapabilityTabs as useTabs } from './nav/state';

export function Layout() {
  const { t } = useTranslation();
  const tabs = useCapabilityTabs().data?.tabs ?? [];
  const badges = useNavBadges(tabs);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [rail, setRail] = useStored('wardarr.nav.rail', false);
  const [palette, setPalette] = useState(false);
  const openPalette = useCallback(() => setPalette(true), []);
  usePaletteShortcut(openPalette);

  return (
    <div className="min-h-dvh pb-20 lg:pb-0">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
      >
        {t('ui.nav.skip')}
      </a>
      <Sidebar
        tabs={tabs}
        pathname={pathname}
        rail={rail}
        onRail={setRail}
        onSearch={openPalette}
        badges={badges}
      />
      <MobileHeader onSearch={openPalette} />

      <div className={`transition-[padding] duration-200 ease-out ${rail ? 'lg:pl-[4.5rem]' : 'lg:pl-60'}`}>
        <main id="main" className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">
          <ViewTransition view={pathname.split('/')[1] ?? ''}>
            <Outlet />
          </ViewTransition>
        </main>
      </div>

      <BottomBar tabs={tabs} pathname={pathname} badges={badges} onSearch={openPalette} />
      <CommandPalette open={palette} onOpenChange={setPalette} tabs={tabs} />
    </div>
  );
}
