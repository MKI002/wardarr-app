# Writing an adapter

An adapter teaches Wardarr to talk to one service. It describes the form for
adding an instance, checks the connection and translates the service's API
into the shapes the rest of Wardarr understands. Nothing outside
`packages/adapters` needs to change: the interface shows what an adapter's
capabilities allow.

This guide walks through a small adapter, the tests every adapter gets and the
rules that keep adapters safe.

## The shape

```ts
// packages/adapters/src/subtitles/example.ts
import { AdapterError, defineAdapter, type Signal } from '@wardarr/core';
import { apiKeyField, apiKeySchema } from '../shared/fields.js';
import { jsonOf } from '../shared/http.js';

export const example = defineAdapter({
  id: 'example', // lowercase, stable: it is stored in the database
  name: 'Example', // product name shown in the interface
  category: 'arr', // arr | indexer | downloader | mediaServer | requests
  lifecycle: 'active', // or 'upstreamDiscontinued'
  homepage: 'https://example.org',
  fields: [apiKeyField], // the "add instance" form
  credentials: apiKeySchema, // zod schema for those fields
  capabilities: ['health'], // what the adapter can do
  create(ctx) {
    const headers = { 'X-Api-Key': ctx.credentials.apiKey };
    const get = async <T>(path: string) => jsonOf<T>(await ctx.http.request({ path, headers }));
    return {
      async testConnection() {
        const status = await get<{ version?: string }>('/api/status');
        if (typeof status.version !== 'string') throw new AdapterError('badResponse', 'not an Example API');
        return { version: status.version };
      },
      async health() {
        const list = await get<Array<{ source?: string; message?: string }>>('/api/health');
        return list.map((h): Signal => ({
          origin: 'service',
          instance: { id: ctx.instanceId, name: ctx.instanceName, adapter: 'example' },
          kind: 'health',
          source: h.source,
          level: 'warning',
          message: h.message ?? '',
        }));
      },
      webUrl() {
        return `${ctx.baseUrl}/system/status`;
      },
    };
  },
});
```

Then add it to `ADAPTERS` in `packages/adapters/src/index.ts`. That is all it
takes for it to appear in the settings.

The interface shows the product's logo when
`apps/web/src/assets/logos/<id>.svg` (or `.png`) exists, and a neutral mark with
the initial otherwise. Add a logo only when its license allows it, and list it
in [NOTICE.md](../../NOTICE.md#adding-a-logo).

## The context

`create(ctx)` receives everything the adapter may use:

| Field                                | What it is                                                           |
| ------------------------------------ | -------------------------------------------------------------------- |
| `ctx.baseUrl`                        | The address the admin entered, without a trailing slash              |
| `ctx.credentials`                    | Parsed and validated by your `credentials` schema, decrypted         |
| `ctx.http`                           | The only way to make requests (see below)                            |
| `ctx.instanceId`, `ctx.instanceName` | For signals and log lines                                            |
| `ctx.log`                            | `debug` and `warn`, into the server log, which masks keys and tokens |

## Capabilities

Each capability promises a method. The contract test checks that it exists.

| Capability                    | Method                                   | Used by                          |
| ----------------------------- | ---------------------------------------- | -------------------------------- |
| `health`                      | `health()`                               | Issue Center                     |
| `queue`                       | `queue()`                                | Queue Cleaner, overview          |
| `queueActions`                | `removeQueueItem()`                      | Queue Cleaner                    |
| `manualImport`                | `importPreview()`, `importFiles()`       | "Review import"                  |
| `wanted`, `search`, `history` | `wanted()`, `search()`, `historySince()` | Hunting                          |
| `downloads`                   | `downloads()`                            | Overview, issues for failed jobs |
| `sessions`                    | `sessions()`                             | Now playing, stream history      |
| `library`                     | `libraries()`                            | Library page                     |
| `indexers`                    | `indexers()`                             | Indexers page, indexer issues    |
| `discover`, `requests`        | `discover()`, `requests()` and friends   | Discover and Requests            |
| `settings`                    | `settings()`                             | Read-only settings view          |

The full types live in `packages/core/src/adapter/types.ts`. Optional extras
such as `webUrl()` add deep links into the service, and `topology()` puts the
service on the [stack map](stack-map.md): the other services it is set up to
use (`links`, with the address but never credentials) and the folders it reads
or writes (`folders`, with disk space when the service reports it). Read each
part with `part()` from `shared/topology.ts`, so one missing endpoint only
drops that part.

A download client reports its own problems through `health()` with the helpers
in `packages/adapters/src/downloaders/health.ts`. They emit the sources the
catalog already understands (`Downloader.connection`, `Downloader.trackerError`,
`Downloader.paused`, `Downloader.quota`), so a new client needs no new rule. See
[download client checks](download-clients.md).

## Rules

- **Use `ctx.http`, never `fetch`.** It applies the timeout, the SSRF guard,
  and refuses to forward credentials on redirects.
- **Throw `AdapterError`** with a kind (`unauthorized`, `unreachable`,
  `timeout`, `notFound`, `badResponse`, `blocked`, `unsupported`). The
  interface turns the kind into a helpful message. `jsonOf()` and `ensureOk()`
  in `shared/http.ts` do this for HTTP status codes.
- **Wrong credentials must end up as `unauthorized`**, so the form can say so.
- **Never return secrets.** `settings()` masks them; `toEntries()` in
  `shared/http.ts` does this for flat objects.
- **Read only, unless the capability says otherwise.** Only queue actions,
  imports, searches and requests change anything in a service.
- **Labels are translation keys.** Field labels and help texts point into
  `packages/i18n/locales/*/adapters.json`; add them in English and German.

## Versions

For \*arr style APIs, `shared/apiVersion.ts` detects which API version a
service offers and picks the newest one Wardarr implements. Declare the API
versions and the product majors you tested with; when a service is newer,
Wardarr keeps working in compatibility mode and shows a quiet notice. See the
Sonarr and Radarr adapters for examples, and
[decision 0003](../decisions/0003-queue-cleaner-hunting-versions.md) for the
reasoning.

## Tests and fixtures

Every adapter needs `packages/adapters/fixtures/<id>.json`: the requests the
adapter makes and the responses an **invented** service would give.

```json
{
  "adapter": "example",
  "baseUrl": "http://example.example.test",
  "credentials": { "apiKey": "00000000000000000000000000000001" },
  "wrongCredentials": { "apiKey": "00000000000000000000000000000009" },
  "routes": [
    {
      "path": "/api/status",
      "headers": { "X-Api-Key": "00000000000000000000000000000001" },
      "json": { "version": "1.0.0" }
    },
    { "path": "*", "status": 401 }
  ],
  "expect": { "version": "1.0.0" }
}
```

The contract test (`packages/adapters/test/contract.test.ts`) then checks
for every adapter that the definition is valid and translated, every
capability is implemented, the connection reports the version, wrong
credentials give `unauthorized` and network failures stay `AdapterError`s.
Add `expect` entries for `health`, `queue`, `downloads` and the others your
adapter supports.

Build fixtures from the public API documentation, never from a copy of your
own instance: no real titles, names, paths, host names or keys. The privacy
hooks check for the obvious ones, but they cannot know your library.

Run `pnpm test`, then try the adapter in the [testbed](../../testbed/README.md).
