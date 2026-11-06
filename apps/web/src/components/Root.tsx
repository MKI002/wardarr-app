// Gate: setup wizard, login, or the app shell.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { connectEvents } from '../lib/events';
import { SessionProvider, useMe, useSetupStatus } from '../lib/session';
import { LoginPage } from '../pages/Login';
import { SetupWizard } from '../pages/Setup';
import { Layout } from './Layout';
import { InlineError, Skeleton } from './ui';

function Events() {
  const client = useQueryClient();
  useEffect(() => connectEvents(client), [client]);
  return null;
}

export function Root() {
  const { t } = useTranslation();
  const setup = useSetupStatus();
  const me = useMe();
  // The wizard stays open after the admin account exists, until the user
  // finishes the service step, even though setup status changes meanwhile.
  const [wizard, setWizard] = useState(false);
  const needsSetup = setup.data?.needsSetup === true;
  if (needsSetup && !wizard) setWizard(true);

  if (setup.isError || me.isError) {
    return (
      <main className="mx-auto max-w-md p-6">
        <InlineError
          message={t('ui.errors.serverUnreachable')}
          next={t('ui.errors.serverUnreachableNext')}
          onRetry={() => void Promise.all([setup.refetch(), me.refetch()])}
        />
      </main>
    );
  }
  if (setup.isPending || me.isPending) {
    return (
      <main className="mx-auto flex max-w-md flex-col gap-3 p-6" aria-busy>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40" />
      </main>
    );
  }
  if (needsSetup || wizard) return <SetupWizard onDone={() => setWizard(false)} />;
  if (!me.data) return <LoginPage />;
  return (
    <SessionProvider me={me.data}>
      <Events />
      <Layout />
    </SessionProvider>
  );
}
