// Masks secrets, URLs and user names in logs and error reports.

const SECRET_KEY_NAME =
  /(pass(word)?|secret|token|api[-_]?key|apikey|auth(orization)?|cookie|session|credential|private)/i;
const USER_KEY_NAME = /^(user(name)?|login|account|email|owner)$/i;
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;
// Long hex or base64-like runs are treated as keys.
const KEY_PATTERN = /\b(?:[a-f0-9]{24,}|[A-Za-z0-9_-]{32,})\b/g;
const SENSITIVE_QUERY = /([?&](?:api[-_]?key|apikey|token|x-plex-token|password|pass|auth)=)[^&#\s]*/gi;

export const MASK = '[redacted]';

/** Keeps the scheme and path shape of a URL, hides host, credentials and query. */
export function maskUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const p = url.pathname.length > 1 ? url.pathname : '';
    return `${url.protocol}//[host]${p}${url.search ? '?[query]' : ''}`;
  } catch {
    return '[url]';
  }
}

export function redactString(value: string): string {
  return value
    .replace(SENSITIVE_QUERY, `$1${MASK}`)
    .replace(URL_PATTERN, (m) => maskUrl(m))
    .replace(KEY_PATTERN, '[key]');
}

/** Deep copy with secrets, user names and URLs masked. Handles cycles. */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY_NAME.test(k)) out[k] = MASK;
    else if (USER_KEY_NAME.test(k) && typeof v === 'string') out[k] = '[user]';
    else out[k] = redact(v, seen);
  }
  return out;
}
