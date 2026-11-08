// Command palette (⌘K / Ctrl K / "/"): jump to any page, settings section or
// connected service by typing a few letters.
import * as RadixDialog from '@radix-ui/react-dialog';
import { useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../lib/session';
import { useInstances } from '../InstanceForm';
import { ServiceLogo } from '../ServiceLogo';
import { spring } from '../ui';
import { GROUPS, NavIcon, pathOf } from './model';

const groupOf = (tab: string) => GROUPS.find((g) => g.tabs.includes(tab))?.id;

type Kind = 'pages' | 'settings' | 'services';

interface Entry {
  key: string;
  kind: Kind;
  label: string;
  hint?: string;
  icon: { tab: string } | { adapter: string; name: string };
  /** Extra words that should find this entry, in both languages. */
  words: string;
  go: () => void;
}

/** Words people type for a page besides its name. */
const SYNONYMS: Record<string, string> = {
  overview: 'home start dashboard übersicht',
  issues: 'problems alerts health downloader sabnzbd qbittorrent probleme warnungen',
  map: 'stack map topology graph stack-karte',
  discover: 'tmdb trending popular entdecken',
  requests: 'seerr overseerr jellyseerr anfragen wünsche',
  library: 'plex jellyfin emby streams bibliothek',
  quality:
    'quality score custom formats perfect file codec audio hdr language subtitles qualität punkte sprache untertitel',
  calendar: 'ical upcoming releases kalender termine',
  cleaner: 'queue stuck stalled warteschlange hängend',
  hunting: 'search missing upgrade suche fehlend',
  tdarr: 'transcode transcoding encode hevc x265 nodes workers umwandeln',
  trash: 'trash guides profiles custom formats profile',
  indexers: 'prowlarr jackett indexer',
  indexerInsights: 'indexer analysis analyse insights history verlauf prowlarr',
  storage: 'storage disk free speicher platz festplatte',
  backups: 'backup restore retention sicherung wiederherstellen',
  settings: 'preferences options einstellungen',
  instances: 'services connections dienste verbindungen',
  users: 'accounts roles benutzer konten',
  notifications: 'discord ntfy gotify telegram email webhook benachrichtigungen',
  appearance: 'theme dark light language motion design sprache',
};

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** Higher is better; 0 means no match. Every typed word has to match somewhere. */
function score(e: Entry, query: string): number {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const label = fold(e.label);
  const extra = fold(`${e.hint ?? ''} ${e.words}`);
  let total = 0;
  for (const w of words) {
    if (label.startsWith(w)) total += 4;
    else if (label.split(/[\s-]+/).some((part) => part.startsWith(w))) total += 3;
    else if (label.includes(w)) total += 2;
    else if (extra.includes(w)) total += 1;
    else return 0;
  }
  return total;
}

export function CommandPalette({
  open,
  onOpenChange,
  tabs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: string[];
}) {
  const { t } = useTranslation();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              />
            </RadixDialog.Overlay>
            <RadixDialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-x-3 top-[12dvh] z-50 mx-auto flex max-h-[70dvh] max-w-xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={spring}
              >
                <RadixDialog.Title className="sr-only">{t('ui.palette.title')}</RadixDialog.Title>
                <PaletteBody tabs={tabs} close={() => onOpenChange(false)} />
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        ) : null}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}

function PaletteBody({ tabs, close }: { tabs: string[]; close: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { me } = useSession();
  const isAdmin = me.role === 'admin';
  const instances = useInstances();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listId = useId();

  const entries = useMemo<Entry[]>(() => {
    const go = (fn: () => Promise<void>) => () => {
      close();
      void fn();
    };
    const pages: Entry[] = tabs.map((id) => ({
      key: `page:${id}`,
      kind: 'pages',
      label: t(`ui.tabs.${id}`),
      hint: groupOf(id) ? t(`ui.nav.groups.${groupOf(id)}`) : undefined,
      icon: { tab: id },
      words: `${id} ${SYNONYMS[id] ?? ''}`,
      go: go(() => navigate({ to: pathOf(id) })),
    }));
    const sections = (
      isAdmin
        ? (['instances', 'users', 'notifications', 'backups', 'appearance'] as const)
        : (['appearance'] as const)
    ).map<Entry>((s) => ({
      key: `settings:${s}`,
      kind: 'settings',
      label: s === 'backups' ? t('backups.title') : t(`ui.settings.${s}`),
      hint: t('ui.tabs.settings'),
      icon: { tab: s === 'instances' ? 'service' : s },
      words: `settings ${SYNONYMS[s] ?? ''}`,
      go: go(() => navigate({ to: '/settings', search: { section: s } })),
    }));
    const services: Entry[] = isAdmin
      ? (instances.data ?? []).map((i) => ({
          key: `service:${i.id}`,
          kind: 'services',
          label: i.name,
          hint: i.adapter,
          icon: { adapter: i.adapter, name: i.name },
          words: `${i.adapter} ${i.baseUrl}`,
          go: go(() => navigate({ to: '/settings/instances/$id', params: { id: i.id } })),
        }))
      : [];
    return [...pages, ...sections, ...services];
  }, [tabs, isAdmin, instances.data, t, navigate, close]);

  const results = useMemo(() => {
    if (!query.trim()) return entries;
    return entries
      .map((e, i) => ({ e, s: score(e, query), i }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((r) => r.e);
  }, [entries, query]);

  const active = Math.min(cursor, Math.max(results.length - 1, 0));
  const activeKey = results[active]?.key;
  const optionId = (key: string) => `${listId}-${key.replace(/[^a-z0-9-]/gi, '_')}`;

  const move = (to: number) => {
    const next = (to + results.length) % Math.max(results.length, 1);
    setCursor(next);
    const key = results[next]?.key;
    if (key) document.getElementById(optionId(key))?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(active - 1);
    } else if (e.key === 'Home' && e.ctrlKey) {
      e.preventDefault();
      move(0);
    } else if (e.key === 'End' && e.ctrlKey) {
      e.preventDefault();
      move(results.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[active]?.go();
    }
  };

  // Group results by kind, keeping the ranking inside each group when searching.
  const order: Kind[] = ['pages', 'settings', 'services'];
  const grouped = order
    .map((kind) => ({ kind, items: results.filter((r) => r.kind === kind) }))
    .filter((g) => g.items.length);
  const flat = query.trim() ? results : grouped.flatMap((g) => g.items);
  // Keyboard order must follow what is on screen.
  const visualIndex = new Map(flat.map((e, i) => [e.key, i]));

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border px-4">
        <NavIcon id="search" className="size-5 text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeKey ? optionId(activeKey) : undefined}
          aria-autocomplete="list"
          aria-label={t('ui.palette.title')}
          placeholder={t('ui.palette.placeholder')}
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
          // The open palette is the focus; a ring around its only field would just add noise.
          style={{ outline: 'none' }}
        />
        <kbd className="rounded-md border border-border px-1.5 font-sans text-[11px] leading-5 text-muted">
          Esc
        </kbd>
      </div>
      <ul id={listId} role="listbox" aria-label={t('ui.palette.title')} className="overflow-y-auto p-2">
        {flat.length === 0 ? (
          <li className="px-3 py-8 text-center text-sm text-muted" role="presentation">
            {t('ui.palette.empty', { query })}
          </li>
        ) : null}
        {(query.trim() ? [{ kind: null, items: flat }] : grouped).map((g) => (
          <li key={g.kind ?? 'results'} role="presentation">
            {g.kind ? (
              <div
                className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase"
                aria-hidden
              >
                {t(`ui.palette.groups.${g.kind}`)}
              </div>
            ) : null}
            <ul role="group" aria-label={g.kind ? t(`ui.palette.groups.${g.kind}`) : undefined}>
              {g.items.map((e) => {
                const index = visualIndex.get(e.key) ?? 0;
                const selected = index === active;
                return (
                  <li
                    key={e.key}
                    id={optionId(e.key)}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => setCursor(index)}
                    onClick={e.go}
                    className={`relative flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${selected ? 'bg-surface-2 text-text' : 'text-text'}`}
                  >
                    {selected ? (
                      <span
                        aria-hidden
                        className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-accent"
                      />
                    ) : null}
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${selected ? 'bg-surface text-accent' : 'bg-surface-2 text-muted'}`}
                    >
                      {'tab' in e.icon ? (
                        <NavIcon id={e.icon.tab} className="size-[18px]" />
                      ) : (
                        <ServiceLogo adapter={e.icon.adapter} name={e.icon.name} size={18} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{e.label}</span>
                    {e.hint ? <span className="shrink-0 text-xs text-muted">{e.hint}</span> : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted">
        <span>
          <kbd className="font-sans">↑↓</kbd> {t('ui.palette.move')}
        </span>
        <span>
          <kbd className="font-sans">↵</kbd> {t('ui.palette.open')}
        </span>
      </div>
    </>
  );
}
