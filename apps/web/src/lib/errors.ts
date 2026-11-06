import { ApiError } from './api';

type T = (key: string, params?: Record<string, unknown>) => string;

const KNOWN = new Set([
  'invalidCredentials',
  'tooManyAttempts',
  'usernameTaken',
  'lastAdmin',
  'cannotDeleteSelf',
  'setupComplete',
  'forbidden',
]);

/** Turns an API error into a sentence for the user. */
export function errorText(t: T, err: unknown): { message: string; next?: string } {
  if (err instanceof ApiError) {
    if (err.code === 'nameTaken') return { message: t('ui.errors.nameTaken') };
    if (err.code === 'invalidUrl') {
      const reason = (err.details as { reason?: string } | undefined)?.reason ?? 'invalidUrl';
      return { message: t(`ui.instance.urlError.${reason}`) };
    }
    if (err.code === 'tooManyRequests') return { message: t('ui.errors.tooManyAttempts') };
    // The same code means "wrong login" (401) or "credential fields invalid" (400).
    if (err.code === 'invalidCredentials' && err.status === 400)
      return { message: t('ui.errors.validation') };
    if (err.code === 'invalidInput' || err.code === 'invalidName')
      return { message: t('ui.errors.validation') };
    if (KNOWN.has(err.code)) return { message: t(`ui.errors.${err.code}`) };
    if (err.status === 403) return { message: t('ui.errors.forbidden') };
  }
  return { message: t('ui.errors.generic'), next: t('ui.errors.genericNext') };
}
