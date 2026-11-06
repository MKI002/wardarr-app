# Contributing to Wardarr

Thanks for wanting to help. Bug reports, translations, new adapters and fixes
are all welcome.

## Ground rules

- **No personal data, ever.** The repository is public. Code, tests,
  fixtures, screenshots, commit messages and pull requests must not contain
  real names, e-mail addresses, IP addresses, host names, local paths, API
  keys, user names or real library and release data. Use invented values such
  as `Example Harbor`, `sonarr.example.test` or the key
  `00000000000000000000000000000001`. The [privacy guard](docs/privacy-guard.md)
  checks this in git hooks and in CI; set up your local denylist before your
  first commit.
- **Never test against real instances** from the test suite. Use the
  [testbed](testbed/README.md) with its invented services.
- **Commits** use the noreply address of your GitHub account. Source files
  carry no author names; copyright belongs to "The Wardarr Authors".

## Getting started

Requirements: Node.js 24, pnpm 10, gitleaks and exiftool.

```sh
pnpm install        # also installs the git hooks
pnpm dev            # server on :8484, web UI with hot reload
```

| Command                       | What it does                                            |
| ----------------------------- | ------------------------------------------------------- |
| `pnpm lint`                   | ESLint and Prettier                                     |
| `pnpm format`                 | Formats everything with Prettier                        |
| `pnpm typecheck`              | TypeScript in every package                             |
| `pnpm test`                   | Unit and server tests (Vitest)                          |
| `pnpm build && pnpm test:e2e` | End-to-end tests (Playwright) against invented services |
| `pnpm privacy:check`          | All privacy guards over the whole repository            |

## Layout

| Path                | What lives there                                                  |
| ------------------- | ----------------------------------------------------------------- |
| `apps/server`       | Fastify server, database (SQLite with Drizzle), scheduler, routes |
| `apps/web`          | React interface                                                   |
| `apps/e2e`          | Playwright tests and the mock services they run against           |
| `packages/core`     | Adapter contract, issue rules, Queue Cleaner and Hunting logic    |
| `packages/adapters` | One adapter per service, with invented fixtures                   |
| `packages/i18n`     | English and German texts                                          |
| `docs/decisions`    | Why things are the way they are                                   |

## Making a change

1. Open an issue first for larger changes, so we can agree on the approach.
2. Keep pull requests focused. Add tests for new behaviour.
3. Every text the interface shows goes into `packages/i18n/locales/en` **and**
   `de`. A test fails when keys or placeholders differ.
4. Every endpoint declares its access (`public`, `user` or `admin`); the default
   is admin. Secrets are write-only and never leave the server.
5. Record decisions that others would wonder about in `docs/decisions/`.
6. Run `pnpm lint`, `pnpm typecheck` and `pnpm test` before you push.

## Adding a service

See the [adapter guide](docs/guide/adapters.md).

## Translations

Copy the English files in `packages/i18n/locales/en` to a new folder, translate
the values (not the keys), keep every `{{placeholder}}` and register the
language in `packages/i18n/src/index.ts`. The parity test tells you what is
missing.

## Design

Calm, minimal and friendly. Dark by default, light just as good. Animations
are short (150 to 300 ms) and respect reduced motion. Loading states use
skeletons, errors appear where they happen and say what to do next. Every
control works with the keyboard and meets WCAG AA contrast.

## Code of conduct

Be kind and assume good intent. Harassment of any kind is not tolerated.
