// What the navigation shows: the pages grouped into sections, their paths and
// icons. The server decides which pages a user may see (/api/capabilities);
// this file only decides where they go.

export type GroupId = 'status' | 'media' | 'automation' | 'system';

/** Sections in the order they appear; Settings sits apart at the bottom. */
export const GROUPS: Array<{ id: GroupId; tabs: string[] }> = [
  { id: 'status', tabs: ['overview', 'issues', 'map'] },
  { id: 'media', tabs: ['discover', 'requests', 'library', 'quality', 'calendar'] },
  { id: 'automation', tabs: ['cleaner', 'hunting', 'gatekeeper', 'trash', 'tdarr'] },
  { id: 'system', tabs: ['indexers', 'indexerInsights', 'storage'] },
];

export const TAB_PATHS: Record<string, string> = {
  overview: '/',
  issues: '/issues',
  map: '/map',
  discover: '/discover',
  requests: '/requests',
  library: '/library',
  quality: '/quality',
  calendar: '/calendar',
  cleaner: '/cleaner',
  hunting: '/hunting',
  trash: '/trash',
  tdarr: '/tdarr',
  gatekeeper: '/gatekeeper',
  indexers: '/indexers',
  indexerInsights: '/indexer-insights',
  storage: '/storage',
  settings: '/settings',
};

export const pathOf = (id: string) => TAB_PATHS[id] ?? `/${id}`;

export function isActive(id: string, pathname: string): boolean {
  const path = pathOf(id);
  return path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
}

export interface NavGroup {
  id: GroupId;
  tabs: string[];
}

/**
 * The allowed tabs sorted into sections. A tab this file does not know yet
 * still shows up, at the end of "System", so a new page is never unreachable.
 * Empty sections are left out.
 */
export function groupTabs(allowed: string[]): NavGroup[] {
  const known = new Set(GROUPS.flatMap((g) => g.tabs));
  const extra = allowed.filter((id) => id !== 'settings' && !known.has(id));
  return GROUPS.map((g) => ({
    id: g.id,
    tabs: [...g.tabs.filter((id) => allowed.includes(id)), ...(g.id === 'system' ? extra : [])],
  })).filter((g) => g.tabs.length > 0);
}

/** The tabs a phone shows in its bottom bar, most used first. */
const PHONE_PRIORITY = ['overview', 'issues', 'discover', 'library', 'requests', 'cleaner', 'settings'];

export function phoneTabs(allowed: string[]): { primary: string[]; rest: boolean } {
  if (allowed.length <= 5) return { primary: allowed, rest: false };
  const ranked = [
    ...PHONE_PRIORITY.filter((id) => allowed.includes(id)),
    ...allowed.filter((id) => !PHONE_PRIORITY.includes(id)),
  ];
  return { primary: ranked.slice(0, 4), rest: true };
}

const ICONS: Record<string, string> = {
  overview: 'M3 12h7V3H3zm0 9h7v-7H3zm11 0h7v-9h-7zm0-18v7h7V3z',
  issues: 'M12 3 2 20h20zm0 6v5m0 3h.01',
  map: 'M3 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M17 6a2 2 0 1 0 4 0a2 2 0 1 0-4 0M10 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 6h10M6 7.7l5 8.6M18 7.7l-5 8.6',
  discover: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm3.5 5.5-2 5-5 2 2-5z',
  requests: 'M8 4h8l1 3H7zM5 7h14v13H5zM9 12h6M9 16h4',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-1 2 15.5-3.5 1z',
  quality: 'M7 4h10l4 5-9 11L3 9zM3 9h18M10 4 8.5 9 12 20l3.5-11L14 4',
  calendar: 'M4 6.5h16V20H4zM4 10.5h16M8.5 3.5v5M15.5 3.5v5M8 14.5h3v3H8z',
  cleaner: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  hunting: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4M11 8v6M8 11h6',
  tdarr: 'M4 9a8 8 0 0 1 14.5-3.5M20 4v4h-4M20 15a8 8 0 0 1-14.5 3.5M4 20v-4h4M10 9.5v5l4-2.5z',
  gatekeeper: 'M7 3h7l4 4v14H7zM14 3v4h4M10 12l4 4M14 12l-4 4',
  trash: 'M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6zM8.5 12l2.5 2.5 4.5-5',
  indexers: 'M4 6h16M4 12h16M4 18h10M18 16l2 2-2 2',
  indexerInsights: 'M4 20V10M10 20V4M16 20v-7M21 20H3',
  storage:
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  backups: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.5 4a8.5 8.5 0 0 0-.2-1.8l2-1.6-2-3.4-2.4 1a8 8 0 0 0-3-1.8L14.5 2h-5l-.4 2.4a8 8 0 0 0-3 1.8l-2.4-1-2 3.4 2 1.6a8.5 8.5 0 0 0 0 3.6l-2 1.6 2 3.4 2.4-1a8 8 0 0 0 3 1.8l.4 2.4h5l.4-2.4a8 8 0 0 0 3-1.8l2.4 1 2-3.4-2-1.6c.1-.6.2-1.2.2-1.8z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4-4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  rail: 'M4 4h16v16H4zM9 4v16',
  chevron: 'm9 6 6 6-6 6',
  service: 'M4 6h16v5H4zM4 13h16v5H4zM8 8.5h.01M8 15.5h.01',
  appearance:
    'M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.5-1.1-1.9-1.1-3 0-.9.7-1.4 1.6-1.4H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 12h.01M9.5 8h.01M14.5 8h.01',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 6',
  notifications: 'M6 17V11a6 6 0 1 1 12 0v6l2 2H4zM10 21h4',
};

export function NavIcon({ id, className = 'size-5' }: { id: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
    >
      <path d={ICONS[id] ?? ICONS.overview} />
    </svg>
  );
}
