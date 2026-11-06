// Small pieces of navigation state: what the viewer folded away (kept in this
// browser only) and the live badges next to a page.
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { api, type IssueView } from '../../lib/api';
import type { Tone } from '../ui';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** useState that survives a reload in this browser; falls back quietly without storage. */
export function useStored<T>(key: string, fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  const set = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Storage may be unavailable (private window); the choice then lasts this visit.
      }
    },
    [key],
  );
  return [value, set];
}

export function useCapabilityTabs() {
  return useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api<{ tabs: string[] }>('/api/capabilities'),
  });
}

export interface NavBadge {
  count: number;
  tone: Tone;
}

/** Open, unmuted issues next to "Issues", tinted by the worst one. */
export function useNavBadges(tabs: string[]): Record<string, NavBadge | undefined> {
  const issues = useQuery({
    queryKey: ['issues', 'all'],
    queryFn: () => api<IssueView[]>('/api/issues?status=all'),
    enabled: tabs.includes('issues'),
  });
  const open = (issues.data ?? []).filter((i) => i.status !== 'resolved' && !i.muted);
  const tone: Tone = open.some((i) => i.group.severity === 'critical')
    ? 'critical'
    : open.some((i) => i.group.severity === 'warning')
      ? 'warning'
      : 'info';
  return { issues: open.length ? { count: open.length, tone } : undefined };
}

/** ⌘K on Apple devices, Ctrl K elsewhere. */
export function isApple(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
}

/** Opens the command palette on ⌘K / Ctrl K, and on "/" outside text fields. */
export function usePaletteShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}
