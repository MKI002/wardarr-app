// Product picker and the add/edit form for one instance.
import { useMutation, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type AdapterInfo, type Instance } from '../lib/api';
import { errorText } from '../lib/errors';
import { Badge, Button, InlineError, TextField, spring } from './ui';
import { ServiceLogo } from './ServiceLogo';

export const CATEGORY_ORDER: AdapterInfo['category'][] = [
  'arr',
  'indexer',
  'downloader',
  'mediaServer',
  'requests',
];

export function useAdapters() {
  return useQuery({
    queryKey: ['adapters'],
    queryFn: () => api<AdapterInfo[]>('/api/adapters'),
    staleTime: Infinity,
  });
}

export function useInstances() {
  return useQuery({ queryKey: ['instances'], queryFn: () => api<Instance[]>('/api/instances') });
}

/** "Sonarr", then "Sonarr 2", "Sonarr 3" and so on. */
export function suggestName(product: string, taken: string[]): string {
  const names = new Set(taken.map((n) => n.toLowerCase()));
  if (!names.has(product.toLowerCase())) return product;
  for (let i = 2; ; i++) if (!names.has(`${product} ${i}`.toLowerCase())) return `${product} ${i}`;
}

export function ProductPicker({
  onPick,
  instances,
}: {
  onPick: (a: AdapterInfo) => void;
  instances: Instance[];
}) {
  const { t } = useTranslation();
  const adapters = useAdapters();
  if (adapters.isError)
    return <InlineError message={t('ui.errors.loadFailed')} onRetry={() => void adapters.refetch()} />;
  const list = adapters.data ?? [];
  return (
    <div className="flex flex-col gap-5">
      {CATEGORY_ORDER.map((cat) => {
        const items = list.filter((a) => a.category === cat);
        if (items.length === 0) return null;
        return (
          <section key={cat}>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
              {t(`adapters.category.${cat}`)}
            </h3>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {items.map((a) => {
                const count = instances.filter((i) => i.adapter === a.id).length;
                return (
                  <li key={a.id}>
                    <motion.button
                      type="button"
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.97 }}
                      transition={spring}
                      onClick={() => onPick(a)}
                      className="flex w-full flex-col items-start gap-1 rounded-xl border border-border bg-bg px-3 py-2.5 text-left hover:border-accent"
                    >
                      <span className="flex items-center gap-2 font-medium">
                        <ServiceLogo adapter={a.id} name={a.name} />
                        {a.name}
                      </span>
                      <span className="text-xs text-muted">
                        {count > 0
                          ? t('ui.instance.instances', { count })
                          : t(`adapters.category.${a.category}`)}
                      </span>
                      {a.lifecycle === 'upstreamDiscontinued' ? (
                        <Badge tone="neutral">{t('adapters.lifecycle.upstreamDiscontinued')}</Badge>
                      ) : null}
                    </motion.button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

type FieldValue = string | boolean;

function initialValues(adapter: AdapterInfo, instance?: Instance): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const f of adapter.fields) {
    const v = instance?.fields[f.key];
    if (f.kind === 'boolean') out[f.key] = v === true;
    else if (f.kind === 'secret' || v === null || v === undefined || typeof v === 'object') out[f.key] = '';
    else out[f.key] = String(v);
  }
  return out;
}

interface TestResult {
  ok: boolean;
  version?: string | null;
  error?: string;
}

export function InstanceForm({
  adapter,
  instance,
  takenNames,
  onSaved,
  onCancel,
}: {
  adapter: AdapterInfo;
  instance?: Instance;
  takenNames: string[];
  onSaved: (instance: Instance) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(() => instance?.name ?? suggestName(adapter.name, takenNames));
  const [baseUrl, setBaseUrl] = useState(instance?.baseUrl ?? '');
  const [values, setValues] = useState(() => initialValues(adapter, instance));
  const [insecure, setInsecure] = useState(instance?.allowInsecureTls ?? false);
  const [enabled, setEnabled] = useState(instance?.enabled ?? true);
  const [pollInterval, setPollInterval] = useState(String(instance?.options.pollIntervalSeconds ?? ''));

  const fields = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const f of adapter.fields) {
      const v = values[f.key];
      if (f.kind === 'boolean') out[f.key] = v === true;
      else if (f.kind === 'number') out[f.key] = v === '' ? undefined : Number(v);
      // An empty secret on edit keeps the stored one.
      else if (v !== '' || f.kind !== 'secret') out[f.key] = v === '' ? undefined : v;
    }
    return out;
  }, [adapter.fields, values]);

  const test = useMutation({
    mutationFn: () =>
      api<TestResult>('/api/instances/test', {
        method: 'POST',
        body: { adapter: adapter.id, baseUrl, fields, allowInsecureTls: insecure, instanceId: instance?.id },
      }),
  });

  const save = useMutation({
    mutationFn: () => {
      const options = pollInterval ? { pollIntervalSeconds: Number(pollInterval) } : {};
      return instance
        ? api<Instance>(`/api/instances/${instance.id}`, {
            method: 'PATCH',
            body: { name, baseUrl, fields, allowInsecureTls: insecure, enabled, options },
          })
        : api<Instance>('/api/instances', {
            method: 'POST',
            body: { adapter: adapter.id, name, baseUrl, fields, allowInsecureTls: insecure, options },
          });
    },
    onSuccess: onSaved,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  const testError = test.error ? errorText(t, test.error) : null;
  const saveError = save.error ? errorText(t, save.error) : null;
  const isHttps = baseUrl.trim().toLowerCase().startsWith('https://');

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {adapter.lifecycle === 'upstreamDiscontinued' ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
          {t('ui.instance.discontinued')}
        </p>
      ) : null}
      <TextField
        label={t('ui.instance.name')}
        help={t('ui.instance.nameHelp', { example: suggestName(adapter.name, [adapter.name]) })}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={64}
        required
      />
      <TextField
        label={t('ui.instance.baseUrl')}
        help={t('ui.instance.baseUrlHelp')}
        type="url"
        inputMode="url"
        placeholder="http://"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        required
      />
      {adapter.fields.map((f) =>
        f.kind === 'boolean' ? (
          <label key={f.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values[f.key] === true}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.checked })}
            />
            {t(f.label)}
          </label>
        ) : (
          <TextField
            key={f.key}
            label={f.required ? t(f.label) : `${t(f.label)} (${t('ui.common.optional')})`}
            help={
              f.kind === 'secret' &&
              instance &&
              typeof instance.fields[f.key] === 'object' &&
              (instance.fields[f.key] as { isSet?: boolean } | null)?.isSet
                ? t('ui.common.isSet')
                : f.help
                  ? t(f.help)
                  : undefined
            }
            type={f.kind === 'secret' ? 'password' : f.kind === 'number' ? 'number' : 'text'}
            autoComplete={f.kind === 'secret' ? 'new-password' : 'off'}
            spellCheck={false}
            placeholder={f.placeholder}
            value={String(values[f.key] ?? '')}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            required={f.required && !(f.kind === 'secret' && instance)}
          />
        ),
      )}
      {isHttps || insecure ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={insecure}
            onChange={(e) => setInsecure(e.target.checked)}
          />
          <span>
            {t('ui.instance.insecureTls')}
            <span className="block text-xs text-muted">{t('ui.instance.insecureTlsHelp')}</span>
          </span>
        </label>
      ) : null}
      {instance ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            {t('ui.instance.enabled')}
          </label>
          <TextField
            label={t('ui.instance.pollInterval')}
            type="number"
            min={15}
            max={3600}
            value={pollInterval}
            onChange={(e) => setPollInterval(e.target.value)}
            placeholder="60"
          />
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {test.data ? (
          <motion.p
            key={test.data.ok ? 'ok' : test.data.error}
            role="status"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`rounded-lg px-3 py-2 text-sm ${test.data.ok ? 'bg-ok-bg text-ok' : 'bg-critical-bg text-critical'}`}
          >
            {test.data.ok
              ? test.data.version
                ? t('ui.instance.testOk', { version: test.data.version })
                : t('ui.instance.testOkNoVersion')
              : t(`ui.instance.testFailed.${test.data.error ?? 'badResponse'}`, { product: adapter.name })}
          </motion.p>
        ) : null}
      </AnimatePresence>
      {testError ? <InlineError message={testError.message} next={testError.next} /> : null}
      {saveError ? <InlineError message={saveError.message} next={saveError.next} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => test.mutate()} busy={test.isPending} disabled={!baseUrl}>
          {test.isPending ? t('ui.instance.testing') : t('ui.instance.test')}
        </Button>
        <span className="flex-1" />
        <Button variant="ghost" onClick={onCancel}>
          {t('ui.common.cancel')}
        </Button>
        <Button type="submit" variant="primary" busy={save.isPending}>
          {instance ? t('ui.common.save') : t('ui.instance.add')}
        </Button>
      </div>
    </form>
  );
}
