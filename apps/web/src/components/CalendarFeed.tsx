// The iCal link of the calendar. The link carries a secret token, so it is
// shown once, right after it was made; afterwards only its dates are known.
// Admins also see every link in the household and can revoke each one.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatRelative } from '../lib/format';
import { useSession } from '../lib/session';
import { tint } from './charts';
import { Button, Card, InlineError, SectionTitle, spring } from './ui';

interface FeedInfo {
  id: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface HouseholdFeed extends FeedInfo {
  userId: string;
  username: string;
  displayName: string | null;
}

function absolute(created: { path: string; url: string | null }): string {
  return created.url ?? `${window.location.origin}${created.path}`;
}

export function CalendarFeedCard() {
  const { t, i18n } = useTranslation();
  const { me } = useSession();
  const client = useQueryClient();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const feed = useQuery({
    queryKey: ['calendar', 'feed'],
    queryFn: () => api<{ feed: FeedInfo | null }>('/api/calendar/feed'),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['calendar', 'feed'] });

  const create = useMutation({
    mutationFn: () =>
      api<{ feed: FeedInfo; path: string; url: string | null }>('/api/calendar/feed', { method: 'POST' }),
    onSuccess: (data) => {
      setLink(absolute(data));
      setCopied(false);
      void refresh();
      void client.invalidateQueries({ queryKey: ['calendar', 'feeds'] });
    },
  });
  const revoke = useMutation({
    mutationFn: () => api('/api/calendar/feed', { method: 'DELETE' }),
    onSuccess: () => {
      setLink(null);
      void refresh();
      void client.invalidateQueries({ queryKey: ['calendar', 'feeds'] });
    },
  });

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const info = feed.data?.feed ?? null;
  const error = create.error ?? revoke.error;

  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-xl text-accent"
          style={{ background: tint('accent', 14) }}
          aria-hidden
        >
          <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path
              d="M4 6.5h16V20H4zM4 10.5h16M8.5 3.5v5M15.5 3.5v5M8 14h2M11.5 14h2M15 14h1.5M8 17h2M11.5 17h2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <h2 className="font-semibold">{t('calendar.feed.title')}</h2>
            <p className="text-sm text-muted">{t('calendar.feed.intro')}</p>
          </div>

          {link ? (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring}
              className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3"
            >
              <label className="text-xs font-medium text-muted" htmlFor="calendar-feed-link">
                {t('calendar.feed.label')}
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="calendar-feed-link"
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 font-mono text-xs"
                />
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => void copy()}>
                    {copied ? t('calendar.feed.copied') : t('calendar.feed.copy')}
                  </Button>
                  <a
                    href={link.replace(/^https?:/, 'webcal:')}
                    className="inline-flex min-h-9 items-center rounded-lg bg-surface px-3.5 text-sm font-medium hover:bg-border"
                  >
                    {t('calendar.feed.open')}
                  </a>
                </div>
              </div>
              <p className="text-xs text-muted">{t('calendar.feed.warning')}</p>
            </motion.div>
          ) : null}

          {!link && info ? (
            <p className="text-sm">
              {info.lastUsedAt
                ? t('calendar.feed.active', {
                    created: formatRelative(info.createdAt, i18n.language),
                    used: formatRelative(info.lastUsedAt, i18n.language),
                  })
                : t('calendar.feed.activeNever', { created: formatRelative(info.createdAt, i18n.language) })}
            </p>
          ) : null}
          {revoke.isSuccess && !info && !link ? (
            <p className="text-sm text-muted">{t('calendar.feed.revoked')}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={info ? 'secondary' : 'primary'}
              busy={create.isPending}
              onClick={() => create.mutate()}
            >
              {info ? t('calendar.feed.rotate') : t('calendar.feed.create')}
            </Button>
            {info ? (
              <Button variant="danger" busy={revoke.isPending} onClick={() => revoke.mutate()}>
                {t('calendar.feed.revoke')}
              </Button>
            ) : null}
            {info ? <span className="text-xs text-muted">{t('calendar.feed.rotateHint')}</span> : null}
          </div>
          {error ? <InlineError {...errorText(t, error)} /> : null}

          {me.role === 'admin' ? <HouseholdFeeds /> : null}
        </div>
      </div>
    </Card>
  );
}

function HouseholdFeeds() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const feeds = useQuery({
    queryKey: ['calendar', 'feeds'],
    queryFn: () => api<{ feeds: HouseholdFeed[] }>('/api/calendar/feeds'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/calendar/feeds/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['calendar', 'feeds'] });
      void client.invalidateQueries({ queryKey: ['calendar', 'feed'] });
    },
  });
  const list = feeds.data?.feeds ?? [];
  return (
    <div className="mt-2 border-t border-border pt-4">
      <SectionTitle>{t('calendar.feed.household')}</SectionTitle>
      {list.length === 0 ? (
        <p className="text-sm text-muted">{t('calendar.feed.householdEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
              <span className="min-w-32 font-medium">{f.displayName ?? f.username}</span>
              <span className="text-muted">
                {t('calendar.feed.created')} {formatRelative(f.createdAt, i18n.language)}
              </span>
              <span className="text-muted">
                {t('calendar.feed.used')}{' '}
                {f.lastUsedAt ? formatRelative(f.lastUsedAt, i18n.language) : t('calendar.feed.never')}
              </span>
              <Button
                variant="ghost"
                className="ml-auto"
                busy={revoke.isPending && revoke.variables === f.id}
                onClick={() => revoke.mutate(f.id)}
              >
                {t('calendar.feed.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
