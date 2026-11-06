// Phones and tablets: a slim top bar (logo, search, account), a bottom bar with
// the four most used pages, and "Menu", a sheet with every page in its section.
import * as RadixDialog from '@radix-ui/react-dialog';
import { Link } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo, spring, type Tone } from '../ui';
import { NavIcon, groupTabs, isActive, pathOf, phoneTabs } from './model';
import { AccountMenu } from './Sidebar';
import type { NavBadge } from './state';

const DOT_TONE: Record<Tone, string> = {
  critical: 'bg-critical',
  warning: 'bg-warning-mark',
  info: 'bg-info',
  ok: 'bg-ok',
  neutral: 'bg-muted',
};

function Dot({ badge }: { badge?: NavBadge }) {
  if (!badge) return null;
  return (
    <span
      aria-hidden
      className={`absolute -top-0.5 -right-1 size-2.5 rounded-full ring-2 ring-bg ${DOT_TONE[badge.tone]}`}
    />
  );
}

export function MobileHeader({ onSearch }: { onSearch: () => void }) {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur lg:hidden">
      <div className="flex h-14 items-center gap-2 px-4">
        <Link to="/" aria-label={t('ui.nav.home')}>
          <Logo />
        </Link>
        <button
          type="button"
          onClick={onSearch}
          className="ml-auto flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-text"
          aria-label={t('ui.nav.search')}
        >
          <NavIcon id="search" />
        </button>
        <AccountMenu side="bottom" />
      </div>
    </header>
  );
}

export function BottomBar({
  tabs,
  pathname,
  badges,
  onSearch,
}: {
  tabs: string[];
  pathname: string;
  badges: Record<string, NavBadge | undefined>;
  onSearch: () => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const { primary, rest } = phoneTabs(tabs);
  const elsewhere = rest && !primary.some((id) => isActive(id, pathname));
  const restBadge = rest
    ? Object.entries(badges).find(([id, b]) => b && !primary.includes(id))?.[1]
    : undefined;

  return (
    <>
      <nav
        aria-label={t('ui.nav.main')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <ul className="mx-auto flex max-w-xl justify-around">
          {primary.map((id) => {
            const active = isActive(id, pathname);
            return (
              <li key={id} className="relative">
                <Link
                  to={pathOf(id)}
                  className={`flex min-w-16 flex-col items-center gap-0.5 px-2 pt-2 pb-1.5 text-[11px] font-medium ${active ? 'text-accent' : 'text-muted'}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="relative">
                    <NavIcon id={id} />
                    <Dot badge={badges[id]} />
                  </span>
                  {t(`ui.tabs.${id}`)}
                </Link>
                {active ? (
                  <motion.span
                    layoutId="bottom-pill"
                    aria-hidden
                    className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-accent"
                    transition={spring}
                  />
                ) : null}
              </li>
            );
          })}
          {rest ? (
            <li className="relative">
              <button
                type="button"
                onClick={() => setMenu(true)}
                aria-haspopup="dialog"
                aria-expanded={menu}
                className={`flex min-w-16 flex-col items-center gap-0.5 px-2 pt-2 pb-1.5 text-[11px] font-medium ${elsewhere ? 'text-accent' : 'text-muted'}`}
              >
                <span className="relative">
                  <NavIcon id="menu" />
                  <Dot badge={restBadge} />
                </span>
                {t('ui.nav.menu')}
              </button>
              {elsewhere ? (
                <motion.span
                  layoutId="bottom-pill"
                  aria-hidden
                  className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-accent"
                  transition={spring}
                />
              ) : null}
            </li>
          ) : null}
        </ul>
      </nav>
      <MenuSheet
        open={menu}
        onOpenChange={setMenu}
        tabs={tabs}
        pathname={pathname}
        badges={badges}
        onSearch={() => {
          setMenu(false);
          onSearch();
        }}
      />
    </>
  );
}

function MenuSheet({
  open,
  onOpenChange,
  tabs,
  pathname,
  badges,
  onSearch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: string[];
  pathname: string;
  badges: Record<string, NavBadge | undefined>;
  onSearch: () => void;
}) {
  const { t } = useTranslation();
  const groups = groupTabs(tabs);
  const close = () => onOpenChange(false);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-black/45 lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </RadixDialog.Overlay>
            <RadixDialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-border bg-surface px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl lg:hidden"
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={spring}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 80 || info.velocity.y > 500) close();
                }}
              >
                <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" aria-hidden />
                <RadixDialog.Title className="sr-only">{t('ui.nav.menu')}</RadixDialog.Title>
                <button
                  type="button"
                  onClick={onSearch}
                  className="mb-4 flex h-11 w-full items-center gap-3 rounded-xl border border-border bg-bg px-3 text-sm text-muted"
                >
                  <NavIcon id="search" className="size-4" />
                  {t('ui.nav.searchHint')}
                </button>
                <nav aria-label={t('ui.nav.menu')} className="flex flex-col gap-4">
                  {[
                    ...groups,
                    ...(tabs.includes('settings') ? [{ id: 'more', tabs: ['settings'] }] : []),
                  ].map((g) => (
                    <section key={g.id}>
                      <h2 className="px-1 pb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
                        {g.id === 'more' ? t('ui.nav.groups.more') : t(`ui.nav.groups.${g.id}`)}
                      </h2>
                      <ul className="grid grid-cols-3 gap-2">
                        {g.tabs.map((id) => {
                          const active = isActive(id, pathname);
                          return (
                            <li key={id}>
                              <Link
                                to={pathOf(id)}
                                onClick={close}
                                aria-current={active ? 'page' : undefined}
                                className={`flex h-20 flex-col items-center justify-center gap-1.5 rounded-xl px-1 text-center text-xs font-medium ${active ? 'bg-surface-2 text-accent ring-1 ring-accent/40' : 'bg-bg text-text'}`}
                              >
                                <span className="relative">
                                  <NavIcon id={id} className={`size-6 ${active ? '' : 'text-muted'}`} />
                                  <Dot badge={badges[id]} />
                                </span>
                                <span className="line-clamp-2 leading-tight">{t(`ui.tabs.${id}`)}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                </nav>
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}
