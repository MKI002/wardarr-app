// Session state: setup status, the current user and the CSRF token.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import i18n from './i18n';
import { api, ApiError, setCsrfToken, type Me } from './api';
import { applyTheme } from './theme';

interface SessionValue {
  me: Me['user'];
  refresh(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup'],
    queryFn: () => api<{ needsSetup: boolean }>('/api/setup/status'),
    refetchInterval: false,
  });
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const me = await api<Me>('/api/auth/me');
        setCsrfToken(me.csrfToken);
        return me;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setCsrfToken(null);
          return null;
        }
        throw err;
      }
    },
    refetchInterval: false,
  });
}

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  const client = useQueryClient();
  useEffect(() => {
    applyTheme(me.user.preferences.theme ?? 'system');
    const lang = me.user.preferences.language;
    if (lang && lang !== i18n.language) void i18n.changeLanguage(lang);
    const motion = me.user.preferences.reducedMotion ?? 'system';
    if (motion === 'system') delete document.documentElement.dataset.motion;
    else document.documentElement.dataset.motion = motion;
  }, [me.user.preferences]);
  const reducedMotion = { system: 'user', reduce: 'always', full: 'never' } as const;
  return (
    <SessionContext.Provider
      value={{ me: me.user, refresh: () => client.invalidateQueries({ queryKey: ['me'] }) }}
    >
      <MotionConfig reducedMotion={reducedMotion[me.user.preferences.reducedMotion ?? 'system']}>
        {children}
      </MotionConfig>
    </SessionContext.Provider>
  );
}
