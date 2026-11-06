// Helpers shared by adapters.
import { AdapterError, type HttpResponse, type SettingsEntry, type SignalLevel } from '@wardarr/core';

/** Throws a classified AdapterError for non-2xx responses. */
export function ensureOk(res: HttpResponse): HttpResponse {
  if (res.status >= 200 && res.status < 300) return res;
  if (res.status === 401 || res.status === 403)
    throw new AdapterError('unauthorized', `HTTP ${res.status}`, res.status);
  if (res.status === 404) throw new AdapterError('notFound', 'HTTP 404', 404);
  throw new AdapterError('badResponse', `HTTP ${res.status}`, res.status);
}

export function jsonOf<T>(res: HttpResponse): T {
  return ensureOk(res).json<T>();
}

const SECRET_NAME = /(pass(word)?|secret|token|api[-_]?key|apikey|cert|private)/i;

/** Turns a flat settings object into entries and marks secrets. */
export function toEntries(obj: Record<string, unknown>, extraSecrets: string[] = []): SettingsEntry[] {
  const out: SettingsEntry[] = [];
  for (const [key, raw] of Object.entries(obj)) {
    if (raw !== null && typeof raw === 'object') continue;
    const secret = SECRET_NAME.test(key) || extraSecrets.includes(key);
    const value = raw as SettingsEntry['value'];
    out.push({ key, secret, value: secret ? (value ? '********' : null) : value });
  }
  return out;
}

export function arrLevel(type: string | undefined): SignalLevel {
  switch ((type ?? '').toLowerCase()) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warning';
    case 'notice':
      return 'notice';
    default:
      return 'info';
  }
}

export const trimSlash = (s: string) => s.replace(/\/+$/, '');
