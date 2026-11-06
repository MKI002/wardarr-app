# 0001: Architecture and framework

Status: accepted

## Decision

Wardarr is a TypeScript application in a single container:

- **Server:** Fastify 5 on Node.js 24 LTS. Background jobs and server-sent events run in the same process.
- **Web UI:** React 19 single-page app built with Vite, served by the server.
- **Database:** SQLite through better-sqlite3 and Drizzle ORM with versioned migrations.
- **Repository:** pnpm workspace with `apps/server`, `apps/web`, `packages/core`, `packages/adapters` and `packages/i18n`.

## Reasons

- Fastify registers every route centrally. A global hook denies every request
  without a session unless the route is explicitly marked public, so a new
  endpoint can never be reachable without login by accident.
- Background jobs and SSE are first-class in a long-running Node process.
- Next.js was rejected: jobs and SSE do not fit its request model, and
  middleware-based authentication has been bypassable before (CVE-2025-29927),
  which is exactly the class of bug Wardarr must avoid.
- SvelteKit was rejected: technically sound, but it has a smaller contributor
  pool, and server-side rendering brings nothing to a self-hosted dashboard.
- SQLite keeps the deployment to one file in one volume.
