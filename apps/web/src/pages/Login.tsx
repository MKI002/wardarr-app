import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Guardian, InlineError, TextField, spring } from '../components/ui';
import { api, setCsrfToken, type Me } from '../lib/api';
import { errorText } from '../lib/errors';

export function AuthShell({
  title,
  subtitle,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <motion.div
        className={`w-full ${wide ? 'max-w-xl' : 'max-w-md'}`}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Guardian size={64} />
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
        </div>
        <Card>{children}</Card>
      </motion.div>
    </main>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api<Me>('/api/auth/login', { method: 'POST', body: { username, password } }),
    onSuccess: (me) => {
      setCsrfToken(me.csrfToken);
      client.setQueryData(['me'], me);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };
  const err = login.error ? errorText(t, login.error) : null;
  return (
    <AuthShell title={t('ui.login.title')} subtitle={t('ui.login.subtitle')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('ui.login.username')}
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoFocus
        />
        <TextField
          label={t('ui.login.password')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {err ? <InlineError message={err.message} next={err.next} /> : null}
        <Button type="submit" variant="primary" busy={login.isPending}>
          {t('ui.login.submit')}
        </Button>
      </form>
    </AuthShell>
  );
}
