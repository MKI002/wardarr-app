// An HttpClient that answers from fixture routes, for contract tests.
import type { HttpClient, HttpRequest, HttpResponse } from '@wardarr/core';

export interface FixtureRoute {
  method?: string;
  /** Exact path, or `*` for a catch-all. */
  path: string;
  /** Query values that must be present. */
  query?: Record<string, string>;
  /** Header values that must be present (names are case-insensitive). */
  headers?: Record<string, string>;
  /** Top-level JSON body fields that must match. */
  body?: Record<string, unknown>;
  /** Form fields that must match. */
  form?: Record<string, string>;
  status?: number;
  json?: unknown;
  text?: string;
  responseHeaders?: Record<string, string>;
}

function matches(route: FixtureRoute, req: HttpRequest): boolean {
  if ((route.method ?? 'GET') !== (req.method ?? 'GET') && route.path !== '*') return false;
  if (route.path !== '*' && route.path !== req.path) return false;
  for (const [k, v] of Object.entries(route.query ?? {})) {
    if (String(req.query?.[k]) !== v) return false;
  }
  const headers = Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  for (const [k, v] of Object.entries(route.headers ?? {})) {
    if (headers[k.toLowerCase()] !== v) return false;
  }
  for (const [k, v] of Object.entries(route.body ?? {})) {
    if (JSON.stringify((req.json as Record<string, unknown> | undefined)?.[k]) !== JSON.stringify(v))
      return false;
  }
  for (const [k, v] of Object.entries(route.form ?? {})) {
    if (req.form?.[k] !== v) return false;
  }
  return true;
}

export function createFixtureHttp(routes: FixtureRoute[]): HttpClient & { calls: HttpRequest[] } {
  const calls: HttpRequest[] = [];
  return {
    calls,
    async request(req) {
      calls.push(req);
      const route = routes.find((r) => matches(r, req));
      const status = route?.status ?? (route ? 200 : 404);
      const text = route?.text ?? (route?.json !== undefined ? JSON.stringify(route.json) : '');
      const res: HttpResponse = {
        status,
        headers: Object.fromEntries(
          Object.entries(route?.responseHeaders ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
        ),
        text,
        json<T>() {
          return JSON.parse(text) as T;
        },
      };
      return res;
    },
  };
}
