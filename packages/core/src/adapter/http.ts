// HTTP abstraction adapters use. The server provides an implementation with
// timeouts and SSRF protection; contract tests provide one backed by fixtures.

export interface HttpRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path relative to the instance base URL, starting with `/`. */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** JSON body. Mutually exclusive with `form`. */
  json?: unknown;
  /** URL-encoded form body. */
  form?: Record<string, string>;
  /** Overrides the default timeout for this call. */
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  json<T = unknown>(): T;
}

export interface HttpClient {
  request(req: HttpRequest): Promise<HttpResponse>;
}

/** Builds a query string, skipping undefined values. */
export function buildQuery(query: HttpRequest['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}
