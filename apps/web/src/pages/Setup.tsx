// First-run wizard: admin account, then services (several per product).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { InstanceForm, ProductPicker, useAdapters } from '../components/InstanceForm';
import { Button, Guardian, InlineError, StatusDot, TextField, spring } from '../components/ui';
import { api, setCsrfToken, type AdapterInfo, type Instance, type Me } from '../lib/api';
import { errorText } from '../lib/errors';
import { AuthShell } from './Login';

const PASSWORD_MIN = 10;
const USERNAME = /^[a-zA-Z0-9._-]{3,64}$/;

type Step = 'account' | 'services' | 'done';

function Steps({ step }: { step: Step }) {
  const { t } = useTranslation();
  const steps: Array<[Step, string]> = [
    ['account', t('ui.setup.stepAccount')],
    ['services', t('ui.setup.stepServices')],
    ['done', t('ui.setup.stepDone')],
  ];
  const index = steps.findIndex(([s]) => s === step);
  return (
    <ol className="mb-5 flex items-center gap-2 text-xs" aria-label={t('ui.setup.title')}>
      {steps.map(([id, label], i) => (
        <li
          key={id}
          className="flex flex-1 items-center gap-2"
          aria-current={id === step ? 'step' : undefined}
        >
          <span
            className={`flex size-6 shrink-0 items-center justify-center rounded-full font-semibold ${i <= index ? 'bg-accent text-accent-contrast' : 'bg-surface-2 text-muted'}`}
          >
            {i + 1}
          </span>
          <span className={i === index ? 'font-medium' : 'text-muted'}>{label}</span>
          {i < steps.length - 1 ? <span className="h-px flex-1 bg-border" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

function AccountStep({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const create = useMutation({
    mutationFn: () => api<Me>('/api/setup/admin', { method: 'POST', body: { username, password } }),
    onSuccess: (me) => {
      setCsrfToken(me.csrfToken);
      client.setQueryData(['me'], me);
      onDone();
    },
  });
  const usernameError = touched && !USERNAME.test(username) ? t('ui.errors.usernameInvalid') : undefined;
  const passwordError =
    touched && password.length < PASSWORD_MIN
      ? t('ui.errors.passwordTooShort', { count: PASSWORD_MIN })
      : undefined;
  const confirmError = touched && confirm !== password ? t('ui.errors.passwordMismatch') : undefined;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!USERNAME.test(username) || password.length < PASSWORD_MIN || confirm !== password) return;
    create.mutate();
  };
  const err = create.error ? errorText(t, create.error) : null;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-muted">{t('ui.setup.accountIntro')}</p>
      <TextField
        label={t('ui.setup.username')}
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        error={usernameError}
        autoFocus
      />
      <TextField
        label={t('ui.setup.password')}
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        help={t('ui.setup.passwordHelp', { count: PASSWORD_MIN })}
        error={passwordError}
      />
      <TextField
        label={t('ui.setup.passwordConfirm')}
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={confirmError}
      />
      {err ? <InlineError message={err.message} next={err.next} /> : null}
      <Button type="submit" variant="primary" busy={create.isPending}>
        {t('ui.setup.createAccount')}
      </Button>
    </form>
  );
}

function ServicesStep({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const adapters = useAdapters();
  const [added, setAdded] = useState<Instance[]>([]);
  const [picking, setPicking] = useState<AdapterInfo | null>(null);
  const [showPicker, setShowPicker] = useState(true);
  const adapterName = (id: string) => adapters.data?.find((a) => a.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t('ui.setup.servicesIntro')}</p>
      {added.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-label={t('ui.setup.added')}>
          <AnimatePresence initial={false}>
            {added.map((i) => (
              <motion.li
                key={i.id}
                layout
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={spring}
                className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm"
              >
                <StatusDot tone="ok" label={t('ui.setup.added')} />
                <span className="font-medium">{i.name}</span>
                <span className="text-muted">{adapterName(i.adapter)}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : null}
      <AnimatePresence mode="wait" initial={false}>
        {picking ? (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            <h3 className="mb-3 font-semibold">{t('ui.instance.addTitle', { product: picking.name })}</h3>
            <InstanceForm
              adapter={picking}
              takenNames={added.map((i) => i.name)}
              onSaved={(i) => {
                setAdded((list) => [...list, i]);
                setPicking(null);
                setShowPicker(false);
              }}
              onCancel={() => setPicking(null)}
            />
          </motion.div>
        ) : showPicker ? (
          <motion.div
            key="picker"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            <ProductPicker instances={added} onPick={setPicking} />
          </motion.div>
        ) : (
          <motion.div key="more" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Button onClick={() => setShowPicker(true)}>+ {t('ui.setup.addService')}</Button>
          </motion.div>
        )}
      </AnimatePresence>
      {!picking ? (
        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          {added.length === 0 ? (
            <span className="text-xs text-muted">{t('ui.setup.noneYet')}</span>
          ) : (
            <span />
          )}
          <Button variant={added.length > 0 ? 'primary' : 'ghost'} onClick={onDone}>
            {added.length > 0 ? t('ui.setup.finish') : t('ui.setup.skip')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [step, setStep] = useState<Step>('account');
  const finish = async () => {
    await client.invalidateQueries({ queryKey: ['setup'] });
    window.history.replaceState(null, '', '/');
    onDone();
  };
  return (
    <AuthShell title={t('ui.setup.title')} wide>
      <Steps step={step} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -16 }}
          transition={{ duration: 0.2 }}
        >
          {step === 'account' ? <AccountStep onDone={() => setStep('services')} /> : null}
          {step === 'services' ? <ServicesStep onDone={() => setStep('done')} /> : null}
          {step === 'done' ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <motion.div
                initial={{ scale: 0.6, rotate: -8 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 14 }}
              >
                <Guardian size={72} />
              </motion.div>
              <p className="text-lg font-semibold">{t('ui.setup.doneTitle')}</p>
              <p className="max-w-sm text-sm text-muted">{t('ui.setup.doneBody')}</p>
              <Button variant="primary" onClick={() => void finish()}>
                {t('ui.setup.open')}
              </Button>
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </AuthShell>
  );
}
