// Settings → Notifications: where Wardarr sends news about issues and
// requests. Secrets are write-only; a saved one shows as "Saved".
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorText } from '../lib/errors';
import { formatRelative } from '../lib/format';
import { ConfirmDialog, Dialog } from './Dialog';
import {
  Badge,
  Button,
  Card,
  Choice,
  EmptyState,
  InlineError,
  Select,
  Skeleton,
  TextField,
  Toggle,
  spring,
} from './ui';

type Kind = 'webhook' | 'discord' | 'ntfy' | 'gotify' | 'telegram';
type Threshold = 'critical' | 'warning' | 'info' | 'off';

interface Events {
  issueOpened: Threshold;
  issueResolved: boolean;
  requestPending: boolean;
}

interface Channel {
  id: string;
  name: string;
  kind: Kind;
  enabled: boolean;
  language: 'en' | 'de';
  events: Events;
  config: Record<string, string>;
  secrets: Record<string, { isSet: boolean }>;
  lastSentAt: string | null;
  lastError: string | null;
}

interface Data {
  channels: Channel[];
  kinds: Array<{ kind: Kind; fields: string[]; secrets: string[] }>;
}

const KINDS: Kind[] = ['ntfy', 'discord', 'telegram', 'gotify', 'webhook'];
const DEFAULT_EVENTS: Events = { issueOpened: 'warning', issueResolved: true, requestPending: true };

export function NotificationsSection() {
  const { t } = useTranslation();
  const data = useQuery({ queryKey: ['notifications'], queryFn: () => api<Data>('/api/notifications') });
  const [editing, setEditing] = useState<Channel | Kind | null>(null);
  const [adding, setAdding] = useState(false);

  if (data.isPending) return <Skeleton className="h-40 rounded-[var(--radius-card)]" />;
  if (data.isError) return <InlineError {...errorText(t, data.error)} onRetry={() => void data.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">{t('ui.notifications.intro')}</p>
        <Button variant="primary" onClick={() => setAdding(true)}>
          {t('ui.notifications.add')}
        </Button>
      </div>
      {data.data.channels.length === 0 ? (
        <Card>
          <EmptyState title={t('ui.notifications.empty')} body={t('ui.notifications.emptyBody')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {data.data.channels.map((c) => (
              <motion.li
                key={c.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={spring}
              >
                <ChannelCard channel={c} onEdit={() => setEditing(c)} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <Dialog open={adding} onOpenChange={setAdding} title={t('ui.notifications.pickKind')}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <li key={k}>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setEditing(k);
                }}
                className="flex w-full flex-col items-start gap-0.5 rounded-xl border border-border px-4 py-3 text-left hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                <span className="font-medium">{t(`ui.notifications.kind.${k}`)}</span>
                <span className="text-xs text-muted">{t(`ui.notifications.kindHint.${k}`)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
      {editing ? (
        <ChannelDialog
          key={typeof editing === 'string' ? `new:${editing}` : editing.id}
          channel={typeof editing === 'string' ? null : editing}
          kind={typeof editing === 'string' ? editing : editing.kind}
          fields={data.data.kinds.find(
            (k) => k.kind === (typeof editing === 'string' ? editing : editing.kind),
          )}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function ChannelCard({ channel: c, onEdit }: { channel: Channel; onEdit: () => void }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const test = useMutation({
    mutationFn: () =>
      api<{ ok: boolean; error: string | null }>(`/api/notifications/${c.id}/test`, { method: 'POST' }),
    onSettled: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const events = [
    c.events.issueOpened !== 'off' ? t(`ui.notifications.threshold.${c.events.issueOpened}`) : null,
    c.events.issueResolved ? t('ui.notifications.resolved') : null,
    c.events.requestPending ? t('ui.notifications.requests') : null,
  ].filter(Boolean);
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            {c.name}
            {!c.enabled ? <Badge tone="neutral">{t('ui.notifications.off')}</Badge> : null}
            {c.lastError ? <Badge tone="critical">{t('ui.notifications.failing')}</Badge> : null}
          </p>
          <p className="text-xs text-muted">
            {t(`ui.notifications.kind.${c.kind}`)} ·{' '}
            {events.length ? events.join(' · ') : t('ui.notifications.nothing')}
          </p>
          <p className="text-xs text-muted">
            {c.lastSentAt
              ? t('ui.notifications.lastSent', { when: formatRelative(c.lastSentAt, i18n.language) })
              : t('ui.notifications.neverSent')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button busy={test.isPending} onClick={() => test.mutate()}>
            {t('ui.notifications.test')}
          </Button>
          <Button variant="ghost" onClick={onEdit}>
            {t('ui.common.edit')}
          </Button>
        </div>
      </div>
      {test.data ? (
        <p role="status" className={`text-sm ${test.data.ok ? 'text-ok' : 'text-critical'}`}>
          {test.data.ok
            ? t('ui.notifications.testOk')
            : t('ui.notifications.testFailed', {
                reason: t(`ui.instance.testFailed.${test.data.error ?? 'badResponse'}`),
              })}
        </p>
      ) : c.lastError && c.lastError !== 'rateLimited' ? (
        <InlineError
          message={t('ui.notifications.lastError', { reason: t(`ui.instance.testFailed.${c.lastError}`) })}
          next={t('ui.notifications.lastErrorNext')}
        />
      ) : null}
      {test.isError ? <InlineError {...errorText(t, test.error)} /> : null}
    </Card>
  );
}

function ChannelDialog({
  channel,
  kind,
  fields,
  onClose,
}: {
  channel: Channel | null;
  kind: Kind;
  fields?: { fields: string[]; secrets: string[] };
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [open, setOpen] = useState(true);
  const [name, setName] = useState(channel?.name ?? t(`ui.notifications.kind.${kind}`));
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [language, setLanguage] = useState<'en' | 'de'>(
    channel?.language ?? (i18n.language.startsWith('de') ? 'de' : 'en'),
  );
  const [events, setEvents] = useState<Events>(channel?.events ?? DEFAULT_EVENTS);
  const [config, setConfig] = useState<Record<string, string>>(
    channel?.config ?? (kind === 'ntfy' ? { server: 'https://ntfy.sh', topic: '' } : {}),
  );
  const [secret, setSecret] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const close = () => {
    setOpen(false);
    setTimeout(onClose, 200);
  };
  const body = () => ({
    name,
    kind,
    enabled,
    language,
    events,
    config: Object.fromEntries(Object.entries(config).filter(([, v]) => v !== '')),
    secret,
  });
  const save = useMutation({
    mutationFn: () =>
      channel
        ? api(`/api/notifications/${channel.id}`, { method: 'PUT', body: body() })
        : api('/api/notifications', { method: 'POST', body: body() }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['notifications'] });
      close();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/notifications/${channel!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['notifications'] });
      setConfirmDelete(false);
      close();
    },
  });
  const optionalSecret = kind === 'webhook' || kind === 'ntfy';

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (o ? null : close())}
      title={
        channel ? t('ui.notifications.editTitle', { name: channel.name }) : t(`ui.notifications.kind.${kind}`)
      }
      description={t(`ui.notifications.kindHint.${kind}`)}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <TextField
          label={t('ui.notifications.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        {(fields?.fields ?? []).map((f) => (
          <TextField
            key={f}
            label={t(`ui.notifications.field.${f}`)}
            help={t(`ui.notifications.fieldHelp.${f}`, { defaultValue: '' }) || undefined}
            value={config[f] ?? ''}
            onChange={(e) => setConfig((c) => ({ ...c, [f]: e.target.value }))}
            required={!(kind === 'ntfy' && f === 'server')}
            autoComplete="off"
            spellCheck={false}
          />
        ))}
        {(fields?.secrets ?? []).map((f) => (
          <TextField
            key={f}
            type="password"
            label={`${t(`ui.notifications.field.${f}`)}${optionalSecret ? ` (${t('ui.common.optional')})` : ''}`}
            help={
              channel?.secrets[f]?.isSet
                ? t('ui.common.isSet')
                : t(`ui.notifications.fieldHelp.${f}`, { defaultValue: '' }) || undefined
            }
            value={secret[f] ?? ''}
            onChange={(e) => setSecret((s) => ({ ...s, [f]: e.target.value }))}
            required={!optionalSecret && !channel?.secrets[f]?.isSet}
            autoComplete="new-password"
          />
        ))}
        <fieldset className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <legend className="px-1 text-sm font-medium">{t('ui.notifications.when')}</legend>
          <Select
            label={t('ui.notifications.newIssues')}
            value={events.issueOpened}
            onChange={(v) => setEvents((e) => ({ ...e, issueOpened: v as Threshold }))}
            options={(['critical', 'warning', 'info', 'off'] as const).map((v) => [
              v,
              t(`ui.notifications.threshold.${v}`),
            ])}
          />
          <Toggle
            label={t('ui.notifications.resolved')}
            help={t('ui.notifications.resolvedHelp')}
            checked={events.issueResolved}
            onChange={(v) => setEvents((e) => ({ ...e, issueResolved: v }))}
          />
          <Toggle
            label={t('ui.notifications.requests')}
            help={t('ui.notifications.requestsHelp')}
            checked={events.requestPending}
            onChange={(v) => setEvents((e) => ({ ...e, requestPending: v }))}
          />
        </fieldset>
        <Choice
          label={t('ui.notifications.language')}
          value={language}
          onChange={setLanguage}
          options={[
            ['en', t('ui.languages.en')],
            ['de', t('ui.languages.de')],
          ]}
        />
        <Toggle label={t('ui.notifications.enabled')} checked={enabled} onChange={setEnabled} />
        {save.isError ? <InlineError {...errorText(t, save.error)} /> : null}
        <div className="flex flex-wrap justify-between gap-2">
          {channel ? (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              {t('ui.common.delete')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close}>
              {t('ui.common.cancel')}
            </Button>
            <Button variant="primary" type="submit" busy={save.isPending}>
              {t('ui.common.save')}
            </Button>
          </div>
        </div>
      </form>
      {channel ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('ui.notifications.deleteTitle', { name: channel.name })}
          body={t('ui.notifications.deleteBody')}
          confirmLabel={t('ui.common.delete')}
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate()}
        />
      ) : null}
    </Dialog>
  );
}
