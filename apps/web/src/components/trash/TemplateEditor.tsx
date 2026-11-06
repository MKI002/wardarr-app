// Template editor: TRaSH profiles with their custom format groups, own
// scores, quality sizes and naming. The summary on the right is resolved by
// the server against the current guide, so it shows exactly what a sync sets.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { errorText } from '../../lib/errors';
import {
  emptyConfig,
  type Catalog,
  type CatalogProfile,
  type Explanation,
  type TemplateConfig,
  type TemplateProfile,
  type TrashProduct,
  type TrashTemplate,
} from '../../lib/trash';
import { ConfirmDialog } from '../Dialog';
import {
  Badge,
  Button,
  Card,
  Choice,
  Disclosure,
  InlineError,
  Select,
  Skeleton,
  TextField,
  Toggle,
} from '../ui';

export interface EditorInput {
  id?: string;
  name: string;
  product: TrashProduct;
  config: TemplateConfig;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function ProfileEditor({
  catalog,
  profile,
  value,
  explanation,
  onChange,
  onRemove,
}: {
  catalog: Catalog;
  profile: CatalogProfile | undefined;
  value: TemplateProfile;
  explanation: Explanation['profiles'][number] | undefined;
  onChange: (p: TemplateProfile) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [extra, setExtra] = useState('');
  const groups = catalog.groups.filter((g) => profile?.groups.includes(g.trashId));
  const toggleGroup = (id: string, on: boolean) =>
    onChange({ ...value, groups: on ? [...value.groups, id] : value.groups.filter((g) => g !== id) });
  const toggleFormat = (id: string, preselected: boolean, on: boolean) => {
    if (preselected) {
      const excludedFormats = on
        ? value.excludedFormats.filter((x) => x !== id)
        : [...value.excludedFormats, id];
      onChange({ ...value, excludedFormats });
    } else {
      const extraFormats = on ? [...value.extraFormats, id] : value.extraFormats.filter((x) => x !== id);
      onChange({ ...value, extraFormats });
    }
  };
  const setScore = (id: string, raw: string) => {
    const scoreOverrides = { ...value.scoreOverrides };
    if (raw.trim() === '' || !Number.isFinite(Number(raw))) delete scoreOverrides[id];
    else scoreOverrides[id] = Math.round(Number(raw));
    onChange({ ...value, scoreOverrides });
  };
  const used = new Set(explanation?.formats.map((f) => f.trashId) ?? []);
  const extraOptions = catalog.customFormats.filter((cf) => !used.has(cf.trashId));

  if (!profile) {
    return (
      <Card className="flex items-center justify-between gap-3">
        <p className="text-sm text-warning">{t('trash.editor.profileGone')}</p>
        <Button variant="danger" onClick={onRemove}>
          {t('trash.editor.removeProfile')}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{profile.name}</h3>
            <Badge tone="neutral">{profile.category}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">{profile.description.replace(/<br\s*\/?>/gi, ' ')}</p>
          {profile.url ? (
            <a
              href={profile.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs text-accent hover:underline"
            >
              {t('trash.editor.readGuide')}
            </a>
          ) : null}
        </div>
        <Button variant="ghost" onClick={onRemove}>
          {t('trash.editor.removeProfile')}
        </Button>
      </div>
      <TextField
        label={t('trash.editor.profileName')}
        help={t('trash.editor.profileNameHelp')}
        placeholder={profile.name}
        value={value.name ?? ''}
        maxLength={100}
        onChange={(e) => onChange({ ...value, name: e.target.value || undefined })}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t('trash.editor.groups')}</legend>
        {groups.length === 0 ? <p className="text-sm text-muted">{t('trash.editor.noGroups')}</p> : null}
        <ul className="flex flex-col gap-2">
          {groups.map((g) => {
            const on = value.groups.includes(g.trashId);
            return (
              <li key={g.trashId} className="rounded-lg border border-border p-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 accent-accent"
                    checked={on}
                    onChange={(e) => toggleGroup(g.trashId, e.target.checked)}
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {g.name}
                      {g.recommended ? <Badge tone="info">{t('trash.editor.recommended')}</Badge> : null}
                    </span>
                    <span className="text-xs text-muted">{g.description.replace(/<[^>]+>/g, ' ')}</span>
                  </span>
                </label>
                {on ? (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 pl-7">
                    {g.formats.map((f) => {
                      const checked =
                        f.required ||
                        (f.preselected
                          ? !value.excludedFormats.includes(f.trashId)
                          : value.extraFormats.includes(f.trashId));
                      return (
                        <label key={f.trashId} className="flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            disabled={f.required}
                            checked={checked}
                            onChange={(e) => toggleFormat(f.trashId, f.preselected, e.target.checked)}
                            className="accent-accent"
                          />
                          {f.name}
                          {f.required ? (
                            <span className="text-muted">({t('trash.editor.required')})</span>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </fieldset>
      <Disclosure title={t('trash.editor.scores', { count: explanation?.formats.length ?? 0 })}>
        <p className="text-xs text-muted">
          {t('trash.editor.scoresHelp', { set: explanation?.scoreSet ?? profile.scoreSet })}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">{t('trash.editor.format')}</th>
                <th className="py-1 pr-3 font-medium">{t('trash.editor.from')}</th>
                <th className="py-1 pr-3 text-right font-medium">{t('trash.editor.guideScore')}</th>
                <th className="py-1 font-medium">{t('trash.editor.ownScore')}</th>
              </tr>
            </thead>
            <tbody>
              {(explanation?.formats ?? []).map((f) => (
                <tr key={f.trashId} className="border-t border-border">
                  <td className="py-1.5 pr-3">{f.name}</td>
                  <td className="py-1.5 pr-3 text-xs text-muted">
                    {f.source === 'group' ? f.group : t(`trash.editor.source.${f.source}`)}
                    {f.source === 'extra' ? (
                      <button
                        type="button"
                        className="ml-2 text-critical hover:underline"
                        onClick={() =>
                          onChange({
                            ...value,
                            extraFormats: value.extraFormats.filter((x) => x !== f.trashId),
                          })
                        }
                      >
                        {t('ui.common.delete')}
                      </button>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{f.guideScore}</td>
                  <td className="py-1.5">
                    <input
                      type="number"
                      aria-label={t('trash.editor.ownScoreFor', { name: f.name })}
                      className="min-h-8 w-24 rounded-md border border-border bg-bg px-2 text-sm tabular-nums"
                      placeholder={String(f.guideScore)}
                      value={value.scoreOverrides[f.trashId] ?? ''}
                      onChange={(e) => setScore(f.trashId, e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Select
            label={t('trash.editor.addFormat')}
            value={extra}
            onChange={setExtra}
            options={[
              ['', t('trash.editor.pickFormat')],
              ...extraOptions.map((cf): [string, string] => [cf.trashId, cf.name]),
            ]}
          />
          <Button
            disabled={!extra}
            onClick={() => {
              onChange({ ...value, extraFormats: [...value.extraFormats, extra] });
              setExtra('');
            }}
          >
            {t('ui.common.add')}
          </Button>
        </div>
      </Disclosure>
    </Card>
  );
}

export function TemplateEditor({
  input,
  onClose,
  onSaved,
}: {
  input: EditorInput;
  onClose: () => void;
  onSaved: (t: TrashTemplate) => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [name, setName] = useState(input.name);
  const [product, setProduct] = useState<TrashProduct>(input.product);
  const [config, setConfig] = useState<TemplateConfig>(input.config);
  const [adding, setAdding] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const catalog = useQuery({
    queryKey: ['trash', 'catalog', product],
    queryFn: () => api<Catalog>(`/api/trash/catalog/${product}`),
    staleTime: 5 * 60_000,
  });
  const debounced = useDebounced(config, 300);
  const explain = useQuery({
    queryKey: ['trash', 'explain', product, debounced],
    queryFn: () =>
      api<Explanation>('/api/trash/resolve', { method: 'POST', body: { product, config: debounced } }),
    enabled: catalog.isSuccess,
    placeholderData: (prev) => prev,
  });
  const save = useMutation({
    mutationFn: () =>
      api<{ template: TrashTemplate }>(
        input.id ? `/api/trash/templates/${input.id}` : '/api/trash/templates',
        {
          method: input.id ? 'PUT' : 'POST',
          body: { name: name.trim(), product, config },
        },
      ),
    onSuccess: (res) => {
      void client.invalidateQueries({ queryKey: ['trash'] });
      onSaved(res.template);
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/trash/templates/${input.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['trash'] });
      onClose();
    },
  });

  const cat = catalog.data;
  const byId = useMemo(() => new Map(cat?.profiles.map((p) => [p.trashId, p]) ?? []), [cat]);
  const available = cat?.profiles.filter((p) => !config.profiles.some((x) => x.trashId === p.trashId)) ?? [];
  const addProfile = () => {
    const p = byId.get(adding);
    if (!p) return;
    setConfig((c) => ({
      ...c,
      profiles: [...c.profiles, p.suggested],
      qualitySize: c.qualitySize ?? p.qualitySize,
    }));
    setAdding('');
  };
  const namingSettings = Object.keys(cat?.naming ?? {});

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {input.id ? t('trash.editor.editTitle') : t('trash.editor.newTitle')}
        </h2>
        <Button variant="ghost" onClick={onClose}>
          {t('ui.common.back')}
        </Button>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-4">
            <TextField
              label={t('trash.editor.name')}
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
            {input.id ? (
              <p className="text-sm text-muted">
                {t('trash.editor.productFixed', { product: t(`trash.product.${product}`) })}
              </p>
            ) : (
              <Choice
                label={t('trash.editor.product')}
                value={product}
                options={[
                  ['radarr', 'Radarr'],
                  ['sonarr', 'Sonarr'],
                ]}
                onChange={(p) => {
                  setProduct(p);
                  setConfig(emptyConfig());
                }}
              />
            )}
          </Card>
          {catalog.isPending ? <Skeleton className="h-40 rounded-[var(--radius-card)]" /> : null}
          {catalog.isError ? (
            <InlineError {...errorText(t, catalog.error)} onRetry={() => void catalog.refetch()} />
          ) : null}
          {cat ? (
            <>
              {config.profiles.map((p, i) => (
                <ProfileEditor
                  key={p.trashId}
                  catalog={cat}
                  profile={byId.get(p.trashId)}
                  value={p}
                  explanation={explain.data?.profiles.find((x) => x.trashId === p.trashId)}
                  onChange={(next) =>
                    setConfig((c) => ({ ...c, profiles: c.profiles.map((x, j) => (j === i ? next : x)) }))
                  }
                  onRemove={() =>
                    setConfig((c) => ({ ...c, profiles: c.profiles.filter((_, j) => j !== i) }))
                  }
                />
              ))}
              <Card className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-sm font-medium">
                  {t('trash.editor.addProfile')}
                  <select
                    value={adding}
                    onChange={(e) => setAdding(e.target.value)}
                    className="min-h-10 rounded-lg border border-border bg-bg px-3 text-sm font-normal"
                  >
                    <option value="">{t('trash.editor.pickProfile')}</option>
                    {cat.categories.map((c) => (
                      <optgroup key={c} label={c}>
                        {available
                          .filter((p) => p.category === c)
                          .map((p) => (
                            <option key={p.trashId} value={p.trashId}>
                              {p.name}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <Button variant="primary" disabled={!adding} onClick={addProfile}>
                  {t('ui.common.add')}
                </Button>
              </Card>
              <Card className="flex flex-col gap-4">
                <Select
                  label={t('trash.editor.qualitySize')}
                  value={config.qualitySize ?? ''}
                  onChange={(v) => setConfig((c) => ({ ...c, qualitySize: v || null }))}
                  options={[
                    ['', t('trash.editor.leaveAlone')],
                    ...cat.qualitySizes.map((s): [string, string] => [s.trashId, s.type]),
                  ]}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  {namingSettings.map((setting) => (
                    <Select
                      key={setting}
                      label={t(`trash.naming.${setting}`, { defaultValue: setting })}
                      value={config.naming[setting] ?? ''}
                      onChange={(v) =>
                        setConfig((c) => {
                          const naming = { ...c.naming };
                          if (v) naming[setting] = v;
                          else delete naming[setting];
                          return { ...c, naming };
                        })
                      }
                      options={[
                        ['', t('trash.editor.leaveAlone')],
                        ...Object.keys(cat.naming[setting] ?? {}).map((v): [string, string] => [v, v]),
                      ]}
                    />
                  ))}
                </div>
                {Object.keys(config.naming).length ? (
                  <Toggle
                    label={t('trash.editor.rename')}
                    help={t('trash.editor.renameHelp')}
                    checked={config.rename}
                    onChange={(rename) => setConfig((c) => ({ ...c, rename }))}
                  />
                ) : null}
              </Card>
            </>
          ) : null}
        </div>
        <aside className="flex flex-col gap-3 lg:sticky lg:top-20 lg:self-start">
          <Card className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">{t('trash.editor.summary')}</h3>
            <p className="text-sm text-muted">
              {t('trash.editor.summaryCounts', {
                profiles: explain.data?.counts.qualityProfiles ?? 0,
                formats: explain.data?.counts.customFormats ?? 0,
              })}
            </p>
            {explain.data?.warnings.length ? (
              <ul className="flex flex-col gap-1 text-sm text-warning">
                {explain.data.warnings.map((w, i) => (
                  <li key={i}>{t(`trash.warning.${w.code}`, w.params)}</li>
                ))}
              </ul>
            ) : null}
            {save.isError ? <InlineError {...errorText(t, save.error)} /> : null}
            <Button
              variant="primary"
              busy={save.isPending}
              disabled={!name.trim() || config.profiles.length === 0}
              onClick={() => save.mutate()}
            >
              {t('ui.common.save')}
            </Button>
            {input.id ? (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                {t('ui.common.delete')}
              </Button>
            ) : null}
            {remove.isError ? <InlineError {...errorText(t, remove.error)} /> : null}
            <p className="text-xs text-muted">{t('trash.editor.saveNote')}</p>
          </Card>
        </aside>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('trash.editor.deleteTitle', { name: input.name })}
        body={t('trash.editor.deleteBody')}
        confirmLabel={t('ui.common.delete')}
        busy={remove.isPending}
        danger
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
