import { BackupsSection } from '../components/BackupsSection';
import { NotificationsSection } from '../components/NotificationsSection';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionMenu } from '../components/ActionMenu';
import { PageHeader } from '../components/dash';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import {
  CATEGORY_ORDER,
  InstanceForm,
  ProductPicker,
  useAdapters,
  useInstances,
} from '../components/InstanceForm';
import {
  Badge,
  Button,
  Card,
  Choice,
  InlineError,
  Skeleton,
  StatusDot,
  TextField,
  ViewTransition,
  spring,
} from '../components/ui';
import { api, type AdapterInfo, type Instance, type Preferences } from '../lib/api';
import { errorText } from '../lib/errors';
import { AVAILABLE_LANGUAGES } from '../lib/i18n';
import { STATUS_TONE, groupByProduct } from '../lib/instances';
import { useSession } from '../lib/session';
import { useOverview } from './Overview';
import { ServiceLogo } from '../components/ServiceLogo';

type Section = 'instances' | 'users' | 'notifications' | 'backups' | 'appearance';

// ---------------------------------------------------------------- instances

function InstancesSection({ editId }: { editId?: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const navigate = useNavigate();
  const adapters = useAdapters();
  const instances = useInstances();
  const overview = useOverview();
  const [adding, setAdding] = useState<AdapterInfo | 'pick' | null>(null);
  const [deleting, setDeleting] = useState<Instance | null>(null);

  const refresh = () => {
    for (const key of ['instances', 'overview', 'capabilities', 'issues', 'queue'])
      void client.invalidateQueries({ queryKey: [key] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/instances/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });

  const list = instances.data ?? [];
  const adapterOf = (id: string) => adapters.data?.find((a) => a.id === id);
  const statusOf = (id: string) => overview.data?.instances.find((i) => i.id === id)?.status ?? 'unknown';
  const editing = editId ? list.find((i) => i.id === editId) : undefined;
  const editingAdapter = editing ? adapterOf(editing.adapter) : undefined;
  const closeEdit = () => void navigate({ to: '/settings', search: { section: 'instances' } });
  const takenNames = list.map((i) => i.name);

  if (instances.isError || adapters.isError)
    return <InlineError message={t('ui.errors.loadFailed')} onRetry={() => void instances.refetch()} />;
  if (!instances.data || !adapters.data) return <Skeleton className="h-48 rounded-[var(--radius-card)]" />;

  const withAdapter = list.map((i) => ({ ...i, adapter: i.adapter }));
  const categories = CATEGORY_ORDER.map((cat) => ({
    cat,
    groups: groupByProduct(withAdapter.filter((i) => adapterOf(i.adapter)?.category === cat)),
  })).filter((c) => c.groups.length > 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted">{t('ui.settings.instancesIntro')}</p>
        <Button variant="primary" onClick={() => setAdding('pick')}>
          + {t('ui.instance.add')}
        </Button>
      </div>
      {categories.length === 0 ? (
        <Card>
          <ProductPicker instances={list} onPick={(a) => setAdding(a)} />
        </Card>
      ) : null}
      {categories.map(({ cat, groups }) => (
        <section key={cat} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">
            {t(`adapters.category.${cat}`)}
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {groups.map((g) => {
              const adapter = adapterOf(g.adapter);
              if (!adapter) return null;
              return (
                <Card key={g.adapter} className="flex flex-col gap-3 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2.5 font-semibold">
                      <ServiceLogo adapter={adapter.id} name={adapter.name} size={24} />
                      {adapter.name}
                    </h3>
                    <Badge tone="neutral">{t('ui.instance.instances', { count: g.items.length })}</Badge>
                  </div>
                  <ul className="flex flex-col gap-1">
                    <AnimatePresence initial={false}>
                      {g.items.map((i) => (
                        <motion.li
                          key={i.id}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={spring}
                          className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2"
                        >
                          <StatusDot
                            tone={i.enabled ? STATUS_TONE[statusOf(i.id)] : 'neutral'}
                            label={t(`ui.status.${i.enabled ? statusOf(i.id) : 'disabled'}`)}
                          />
                          <Link
                            to="/settings/instances/$id"
                            params={{ id: i.id }}
                            className="min-w-0 flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <div className="truncate text-sm font-medium">{i.name}</div>
                            <div className="truncate text-xs text-muted">{i.baseUrl}</div>
                          </Link>
                          <ActionMenu
                            label={t('ui.common.moreActions')}
                            actions={[
                              {
                                label: t('ui.common.edit'),
                                onSelect: () =>
                                  void navigate({ to: '/settings/instances/$id', params: { id: i.id } }),
                              },
                              { label: t('ui.common.delete'), danger: true, onSelect: () => setDeleting(i) },
                            ]}
                          />
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                  <Button variant="ghost" className="self-start" onClick={() => setAdding(adapter)}>
                    + {t('ui.instance.addAnother', { product: adapter.name })}
                  </Button>
                </Card>
              );
            })}
          </div>
        </section>
      ))}

      <Dialog
        open={adding !== null}
        onOpenChange={(open) => !open && setAdding(null)}
        title={
          adding && adding !== 'pick'
            ? t('ui.instance.addTitle', { product: adding.name })
            : t('ui.instance.chooseProduct')
        }
        wide={adding === 'pick'}
      >
        {adding === 'pick' ? <ProductPicker instances={list} onPick={(a) => setAdding(a)} /> : null}
        {adding && adding !== 'pick' ? (
          <InstanceForm
            adapter={adding}
            takenNames={takenNames}
            onSaved={() => {
              setAdding(null);
              refresh();
            }}
            onCancel={() => setAdding(null)}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={!!editing && !!editingAdapter}
        onOpenChange={(open) => !open && closeEdit()}
        title={editing ? t('ui.instance.editTitle', { name: editing.name }) : ''}
      >
        {editing && editingAdapter ? (
          <InstanceForm
            key={editing.id}
            adapter={editingAdapter}
            instance={editing}
            takenNames={takenNames.filter((n) => n !== editing.name)}
            onSaved={() => {
              refresh();
              closeEdit();
            }}
            onCancel={closeEdit}
          />
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('ui.common.delete')}
        body={deleting ? t('ui.instance.deleteConfirm', { name: deleting.name }) : ''}
        confirmLabel={t('ui.common.delete')}
        danger
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

// -------------------------------------------------------------------- users

interface UserRow {
  id: string;
  username: string;
  displayName: string | null;
  role: 'admin' | 'user';
  disabled: boolean;
  createdAt: string;
}

function UsersSection() {
  const { t } = useTranslation();
  const { me } = useSession();
  const client = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/api/users') });
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<UserRow | null>(null);
  const [form, setForm] = useState({ username: '', password: '', role: 'user' as 'admin' | 'user' });
  const refresh = () => void client.invalidateQueries({ queryKey: ['users'] });
  const create = useMutation({
    mutationFn: () => api('/api/users', { method: 'POST', body: form }),
    onSuccess: () => {
      setAdding(false);
      setForm({ username: '', password: '', role: 'user' });
      refresh();
    },
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Pick<UserRow, 'role' | 'disabled'>> }) =>
      api(`/api/users/${id}`, { method: 'PATCH', body }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });
  const err = patch.error ?? remove.error;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setAdding(true)}>
          + {t('ui.settings.addUser')}
        </Button>
      </div>
      {err ? <InlineError message={errorText(t, err).message} /> : null}
      {users.isError ? (
        <InlineError message={t('ui.errors.loadFailed')} onRetry={() => void users.refetch()} />
      ) : null}
      <Card className="p-2">
        <ul className="flex flex-col divide-y divide-border">
          {(users.data ?? []).map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="flex size-8 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold uppercase">
                {u.username.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {u.displayName ?? u.username}{' '}
                  {u.id === me.id ? (
                    <span className="text-xs text-muted">({t('ui.settings.you')})</span>
                  ) : null}
                </div>
                <div className="text-xs text-muted">{u.username}</div>
              </div>
              {u.disabled ? <Badge tone="neutral">{t('ui.settings.disabled')}</Badge> : null}
              <select
                aria-label={t('ui.settings.role')}
                className="min-h-9 rounded-lg border border-border bg-bg px-2 text-sm"
                value={u.role}
                disabled={u.id === me.id}
                onChange={(e) =>
                  patch.mutate({ id: u.id, body: { role: e.target.value as UserRow['role'] } })
                }
              >
                <option value="admin">{t('ui.settings.roleAdmin')}</option>
                <option value="user">{t('ui.settings.roleUser')}</option>
              </select>
              {u.id !== me.id ? (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => patch.mutate({ id: u.id, body: { disabled: !u.disabled } })}
                  >
                    {u.disabled ? t('ui.instance.enabled') : t('ui.settings.disabled')}
                  </Button>
                  <Button variant="ghost" onClick={() => setDeleting(u)}>
                    {t('ui.common.delete')}
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
      <Dialog open={adding} onOpenChange={setAdding} title={t('ui.settings.addUser')}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <TextField
            label={t('ui.setup.username')}
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            autoComplete="off"
            required
          />
          <TextField
            label={t('ui.setup.password')}
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            help={t('ui.setup.passwordHelp', { count: 10 })}
            minLength={10}
            required
          />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t('ui.settings.role')}
            <select
              className="min-h-10 rounded-lg border border-border bg-bg px-3 font-normal"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as 'admin' | 'user' })}
            >
              <option value="user">{t('ui.settings.roleUser')}</option>
              <option value="admin">{t('ui.settings.roleAdmin')}</option>
            </select>
          </label>
          {create.error ? <InlineError message={errorText(t, create.error).message} /> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {t('ui.common.cancel')}
            </Button>
            <Button type="submit" variant="primary" busy={create.isPending}>
              {t('ui.common.add')}
            </Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('ui.common.delete')}
        body={deleting ? t('ui.settings.deleteUserConfirm', { name: deleting.username }) : ''}
        confirmLabel={t('ui.common.delete')}
        danger
        busy={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

// --------------------------------------------------------------- appearance

function AppearanceSection() {
  const { t, i18n } = useTranslation();
  const { me, refresh } = useSession();
  const prefs = me.preferences;
  const save = useMutation({
    mutationFn: (patch: Preferences) => api('/api/auth/me/preferences', { method: 'PUT', body: patch }),
    onSuccess: () => void refresh(),
  });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const changePw = useMutation({
    mutationFn: () => api('/api/auth/me/password', { method: 'PUT', body: pw }),
    onSuccess: () => setPw({ currentPassword: '', newPassword: '' }),
  });

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-5">
        <Choice
          label={t('ui.settings.theme')}
          value={prefs.theme ?? 'system'}
          options={[
            ['system', t('ui.settings.themeSystem')],
            ['dark', t('ui.settings.themeDark')],
            ['light', t('ui.settings.themeLight')],
          ]}
          onChange={(theme) => save.mutate({ theme })}
        />
        <Choice
          label={t('ui.settings.motion')}
          value={prefs.reducedMotion ?? 'system'}
          options={[
            ['system', t('ui.settings.motionSystem')],
            ['reduce', t('ui.settings.motionReduce')],
            ['full', t('ui.settings.motionFull')],
          ]}
          onChange={(reducedMotion) => save.mutate({ reducedMotion })}
        />
        {AVAILABLE_LANGUAGES.length > 1 ? (
          <Choice
            label={t('ui.settings.language')}
            value={prefs.language ?? (i18n.language === 'de' ? 'de' : 'en')}
            options={AVAILABLE_LANGUAGES.map((l) => [l as 'en' | 'de', t(`ui.languages.${l}`)])}
            onChange={(language) => save.mutate({ language })}
          />
        ) : null}
        {save.error ? <InlineError message={errorText(t, save.error).message} /> : null}
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">{t('ui.settings.password')}</h2>
        <form
          className="flex flex-col gap-3 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            changePw.mutate();
          }}
        >
          <TextField
            label={t('ui.settings.currentPassword')}
            type="password"
            autoComplete="current-password"
            value={pw.currentPassword}
            onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
            required
          />
          <TextField
            label={t('ui.settings.newPassword')}
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={pw.newPassword}
            onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
            help={t('ui.setup.passwordHelp', { count: 10 })}
            required
          />
          {changePw.error ? <InlineError message={errorText(t, changePw.error).message} /> : null}
          {changePw.isSuccess ? (
            <p role="status" className="text-sm text-ok">
              {t('ui.settings.passwordChanged')}
            </p>
          ) : null}
          <Button type="submit" variant="primary" className="self-start" busy={changePw.isPending}>
            {t('ui.common.save')}
          </Button>
        </form>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------- page

export function SettingsPage() {
  const { t } = useTranslation();
  const { me } = useSession();
  const search = useSearch({ strict: false }) as { section?: Section };
  const params = useParams({ strict: false }) as { id?: string };
  const isAdmin = me.role === 'admin';
  const sections: Section[] = isAdmin
    ? ['instances', 'users', 'notifications', 'backups', 'appearance']
    : ['appearance'];
  const active: Section = params.id
    ? 'instances'
    : search.section && sections.includes(search.section)
      ? search.section
      : (sections[0] ?? 'appearance');
  const labels: Record<Section, string> = {
    instances: t('ui.settings.instances'),
    users: t('ui.settings.users'),
    notifications: t('ui.settings.notifications'),
    backups: t('backups.title'),
    appearance: t('ui.settings.appearance'),
  };
  const content: Record<Section, ReactNode> = {
    instances: <InstancesSection editId={params.id} />,
    users: <UsersSection />,
    notifications: <NotificationsSection />,
    backups: <BackupsSection />,
    appearance: <AppearanceSection />,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={t('ui.settings.eyebrow')} title={t('ui.settings.title')} />
      {sections.length > 1 ? (
        <nav
          aria-label={t('ui.settings.title')}
          className="flex gap-1 overflow-x-auto border-b border-border"
        >
          {sections.map((s) => (
            <Link
              key={s}
              to="/settings"
              search={{ section: s }}
              aria-current={active === s ? 'page' : undefined}
              className={`relative px-3 py-2 text-sm font-medium whitespace-nowrap ${active === s ? 'text-text' : 'text-muted hover:text-text'}`}
            >
              {labels[s]}
              {active === s ? (
                <motion.span
                  layoutId="settings-tab"
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent"
                  transition={spring}
                />
              ) : null}
            </Link>
          ))}
        </nav>
      ) : null}
      <ViewTransition view={active}>{content[active]}</ViewTransition>
    </div>
  );
}
