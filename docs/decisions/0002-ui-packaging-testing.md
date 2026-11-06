# 0002: Web UI, packaging and end-to-end tests

Status: accepted

## Web UI

- React 19 with TanStack Router and Query, Tailwind CSS 4 and Motion.
- Tabs come from `GET /api/capabilities`. A tab appears only when the user's
  role allows it and a connected service provides what it needs.
- Server-sent events (`/api/events`) carry event names only. The client then
  refetches the affected queries, so no data travels over the event stream.
- Instances are grouped by category and product everywhere. Each product
  can be connected any number of times, each instance with its own name. The
  form suggests "Sonarr 2", "Sonarr 3" and so on when a name is taken.
- Animations are short and respect the operating system's reduced-motion
  setting. Users can also force them on or off in Settings.
- Every issue has "Recheck", including update notices. The specification
  lists only "release notes" and "mute" for updates, but also says every
  issue can be rechecked, so the general rule wins.

## Packaging

- The server is bundled with esbuild into one file. Native modules
  (better-sqlite3, @node-rs/argon2) stay external. No source maps are built.
- The image is multi-stage on `node:24-bookworm-slim`, runs as UID 1000 and
  stores everything under `/data`. The health check calls `/healthz`.
- CI builds an amd64 image on every change and smoke-tests it: health check,
  non-root user, anonymous API access rejected, no source maps. Pushes to
  `main` and version tags publish amd64 and arm64 images to
  `ghcr.io/<owner>/wardarr-app`.

## End-to-end tests

- Playwright drives the built app against invented mock services in
  `apps/e2e/mocks`. They reproduce the service part of the Issue Center
  example deterministically and can be "fixed" at runtime, so recheck and
  resolve can be tested.
- The Jellyfin cache part of the example is a Wardarr-internal job that
  arrives with the library cache in stage 3. Its rule is covered by unit
  tests until then.
- `testbed/` offers the same mocks with Docker Compose, plus an optional
  profile with the real public images, pre-seeded with an invented API key.
