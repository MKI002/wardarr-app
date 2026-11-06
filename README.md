<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/wardarr-lockup-on-dark.svg" />
  <img src="docs/assets/wardarr-lockup-on-light.svg" alt="Wardarr" width="280" />
</picture>

### One calm place for your whole media stack.

Wardarr keeps watch over your \*arr apps, download clients, media servers, Seerr and Tdarr,
so you don't have to. It groups problems by their cause, cleans the download queue with care,
hunts for missing titles at a gentle pace and lets everyone at home ask for something to watch.

<a href="https://mki002.github.io/wardarr-app/"><b>Try the live demo</b></a> ·
<a href="#install">Install</a> ·
<a href="#a-tour">Tour</a> ·
<a href="#configuration">Configuration</a> ·
<a href="#guides">Guides</a> ·
<a href="README.de.md">Deutsch</a>

[![CI](https://github.com/MKI002/wardarr-app/actions/workflows/ci.yml/badge.svg)](https://github.com/MKI002/wardarr-app/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/MKI002/wardarr-app?color=5b45e0&label=release)](https://github.com/MKI002/wardarr-app/releases)
[![Container image](https://img.shields.io/badge/image-ghcr.io-5b45e0)](https://github.com/MKI002/wardarr-app/pkgs/container/wardarr-app)
[![Live demo](https://img.shields.io/badge/demo-live-5b45e0)](https://mki002.github.io/wardarr-app/)
[![License: MIT](https://img.shields.io/badge/license-MIT-5b45e0.svg)](LICENSE)

<br />

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/hero-light.png" />
  <img src="docs/assets/hero-dark.png" alt="Wardarr on a desktop and a phone: the overview with every service on a radar, the issues worth a look, and the library on the phone" />
</picture>

<sub>Every screenshot shows the invented demo setup. Titles, users and numbers are made up; the films are in the public domain.</sub>

</div>

## Why Wardarr

A media stack is a dozen apps that each know a little. When one indexer fails, three of them
complain in three different places. Wardarr reads them all, works out what actually went wrong
and tells you in one sentence, with the fix one click away. Everything else it does follows
the same idea: **show what matters at a glance, explain the rest when asked, and never act
behind your back.**

- **Calm by default.** Problems that fix themselves within a minute stay quiet. The queue
  cleaner starts in dry run, hunting has a budget, and every TRaSH sync shows a preview first.
- **Made for your setup.** Two Sonarrs, a 4K Radarr, three media servers: every product can be
  connected as often as you like. Wardarr detects each service's version and API and keeps up
  when you update.
- **Yours.** One container, one SQLite file, no cloud account, no telemetry, no calls home.

## A tour

The sidebar groups Wardarr's pages by the question you open it with.

### Status: is everything fine?

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/issues.png" alt="Issue Center with one entry per cause, the trend of the last 14 days and the most affected services" /></td>
    <td width="50%"><img src="docs/screenshots/map.png" alt="Stack map: every service, how they connect and the disks they share" /></td>
  </tr>
  <tr>
    <td valign="top"><b>Issues by cause, not by message.</b> One failing indexer becomes one issue with the
    instances it affects, the fix and a link to the right settings page. Mute what you know
    about; resolved issues stay in the history.</td>
    <td valign="top"><b>A map of your stack</b>, drawn from what the services report about each other:
    which app sends to which download client, which disk they share, and where it breaks.</td>
  </tr>
</table>

The **overview** puts it all on one screen: every service as a blip on the radar, what is worth
a look, and what is streaming, downloading and filling up right now.

### Media: what is there to watch?

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/discover.png" alt="Discover: trending films and series, marked when they are in the library, on their way or requested" /></td>
    <td width="50%"><img src="docs/screenshots/library.png" alt="Library: hours watched, plays per day, when people watch and the most watched titles" /></td>
  </tr>
  <tr>
    <td valign="top"><b>Discover and request.</b> Trending, popular and search. Requests go through Seerr as
    the right Seerr user, so its permissions, quotas and approvals stay in charge. Standard or
    4K, and admins approve on the same page.</td>
    <td valign="top"><b>Library and streams.</b> Sizes and counts per media server, what is playing right
    now, plays per day, when people watch and the most watched titles.</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/calendar.png" alt="Calendar: releases of the next days from every Sonarr, Radarr, Lidarr and Readarr" /></td>
    <td><img src="docs/screenshots/requests.png" alt="Requests waiting for approval, approved, on their way and available" /></td>
  </tr>
  <tr>
    <td valign="top"><b>What's coming.</b> One calendar for every Sonarr, Radarr, Lidarr and Readarr, the
    same release from two instances shown once, and a private iCal link for your calendar app.</td>
    <td valign="top"><b>Requests</b> to approve, decline, adjust or retry, with every step from waiting to
    available.</td>
  </tr>
</table>

### Automation: what does Wardarr do for me?

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/cleaner.png" alt="Queue Cleaner in dry run with the downloads it watches and their strikes" /></td>
    <td width="50%"><img src="docs/screenshots/hunting.png" alt="Hunting: calls left this hour, the searches planned for the next 24 hours and the results" /></td>
  </tr>
  <tr>
    <td valign="top"><b>A queue cleaner that asks first.</b> It starts in dry run and shows what it would do.
    Stuck, failed and stalled downloads collect strikes before anything is removed, clean
    imports wait for your "Review import", and arming it is a deliberate step.</td>
    <td valign="top"><b>Hunting at a calm pace.</b> Missing titles and upgrades are searched a few at a time,
    within a budget of API calls, with a pause when indexers are down and a list of what comes
    next and why.</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/trash.png" alt="TRaSH Guides: instances in sync, templates and the guard mode per instance" /></td>
    <td><img src="docs/screenshots/tdarr.png" alt="Tdarr: space saved, nodes and workers, transcodes, health checks and failures per day" /></td>
  </tr>
  <tr>
    <td valign="top"><b>TRaSH Guides, kept in sync.</b> Quality profiles, custom formats, sizes and naming for
    any number of Sonarrs and Radarrs. Every sync shows a field-by-field preview and takes a
    backup you can roll back; a guard reports drift or fixes it, and stops for large changes.</td>
    <td valign="top"><b>Tdarr at a glance.</b> Space saved, nodes and their workers, the queue, and the files
    that failed. A node that goes offline or a job that stops moving becomes an issue.</td>
  </tr>
</table>

### System: how is the stack underneath?

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/storage.png" alt="Storage: the tightest disk with its forecast, free space on every disk and the daily growth" /></td>
    <td width="50%"><img src="docs/screenshots/indexers.png" alt="Indexers from Prowlarr with status, queries, grabs and response times" /></td>
  </tr>
  <tr>
    <td valign="top"><b>Storage with a forecast.</b> Every disk your apps use, counted once even when several
    apps share it, with the day it will be full at the current pace. A disk that fills up soon
    becomes an issue before downloads stop.</td>
    <td valign="top"><b>Indexer statistics.</b> Queries, grabs, failures and response times per indexer from
    Prowlarr, and which apps are left without a working one. <b>Indexer insights</b> show whether
    each app takes its indexers from Prowlarr, has its own or both, and score every indexer over
    time.</td>
  </tr>
</table>

Under **Settings** live the services, users, **notifications** (e-mail, ntfy, Discord, Gotify,
Telegram or any webhook; new issues by default, everything else when you want it) and
**backups** with smart retention: one slider for how often and how long, a backup before every
database update, restore in one click and a passphrase-protected download for moving to a new
server.

### Everywhere

<table>
  <tr>
    <td width="64%"><img src="docs/screenshots/palette.png" alt="Command palette opened with Ctrl K, searching for Radarr" /></td>
    <td width="18%"><img src="docs/screenshots/phone-dark.png" alt="Wardarr overview on a phone in the dark theme" /></td>
    <td width="18%"><img src="docs/screenshots/phone-light.png" alt="Wardarr overview on a phone in the light theme" /></td>
  </tr>
</table>

Press <kbd>Ctrl</kbd> <kbd>K</kbd> (or <kbd>⌘</kbd> <kbd>K</kbd>, or <kbd>/</kbd>) to jump to any
page, setting or service. Dark and light themes follow your system, the app installs on your
phone and works fully with a keyboard, in English and German.

## Supported services

| Kind             | Services                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Media management | <img src="apps/web/src/assets/logos/sonarr.svg" height="16" alt="" /> Sonarr · <img src="apps/web/src/assets/logos/radarr.svg" height="16" alt="" /> Radarr · <img src="apps/web/src/assets/logos/lidarr.svg" height="16" alt="" /> Lidarr · <img src="apps/web/src/assets/logos/whisparr.svg" height="16" alt="" /> Whisparr · <img src="apps/web/src/assets/logos/readarr.svg" height="16" alt="" /> Readarr (no longer developed upstream) · <img src="apps/web/src/assets/logos/bazarr.png" height="16" alt="" /> Bazarr |
| Indexers         | <img src="apps/web/src/assets/logos/prowlarr.svg" height="16" alt="" /> Prowlarr                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Download clients | <img src="apps/web/src/assets/logos/sabnzbd.svg" height="16" alt="" /> SABnzbd · <img src="apps/web/src/assets/logos/nzbget.svg" height="16" alt="" /> NZBGet · <img src="apps/web/src/assets/logos/qbittorrent.svg" height="16" alt="" /> qBittorrent · <img src="apps/web/src/assets/logos/transmission.svg" height="16" alt="" /> Transmission · <img src="apps/web/src/assets/logos/deluge.png" height="16" alt="" /> Deluge                                                                                             |
| Media servers    | <img src="apps/web/src/assets/logos/jellyfin.svg" height="16" alt="" /> Jellyfin · <img src="apps/web/src/assets/logos/plex.svg" height="16" alt="" /> Plex · <img src="apps/web/src/assets/logos/emby.png" height="16" alt="" /> Emby                                                                                                                                                                                                                                                                                       |
| Requests         | <img src="apps/web/src/assets/logos/seerr.svg" height="16" alt="" /> Seerr                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Transcoding      | Tdarr                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Missing one? Adapters are small and self-contained, see the [adapter guide](docs/guide/adapters.md).

## Install

Wardarr runs as one container. Images for `linux/amd64` and `linux/arm64` are published to the
GitHub Container Registry.

### Docker Compose

```yaml
services:
  wardarr:
    image: ghcr.io/mki002/wardarr-app:latest
    container_name: wardarr
    restart: unless-stopped
    ports:
      - '8484:8484'
    volumes:
      - ./wardarr:/data
    environment:
      TZ: Etc/UTC
```

```sh
docker compose up -d
```

A commented example with every option is in [deploy/docker-compose.yml](deploy/docker-compose.yml).

### docker run

```sh
docker run -d --name wardarr --restart unless-stopped \
  -p 8484:8484 -v "$PWD/wardarr:/data" \
  ghcr.io/mki002/wardarr-app:latest
```

### Unraid

Add the template from [deploy/unraid/wardarr.xml](deploy/unraid/wardarr.xml) under
**Docker → Template repositories**, or copy it to `/boot/config/plugins/dockerMan/templates-user/`.
The appdata folder becomes `/data`; the template runs Wardarr as `99:100`, the usual Unraid owner of appdata.

### First start

Open `http://<your-server>:8484`. The setup wizard creates the first admin and walks you through
adding your services. Only admins can add services; everyone else can discover, request and
look at the library.

The data folder must be writable by user `1000:1000`. It holds the SQLite database and the
generated encryption key, so include it in your backups.

## Configuration

Everything else is set in the web interface. These environment variables are optional:

| Variable                  | Default   | What it does                                                                                                                     |
| ------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `WARDARR_PORT`            | `8484`    | Port to listen on.                                                                                                               |
| `WARDARR_HOST`            | `0.0.0.0` | Address to listen on.                                                                                                            |
| `WARDARR_DATA_DIR`        | `/data`   | Database and generated key.                                                                                                      |
| `WARDARR_BACKUP_DIR`      | `backups` | Folder for Wardarr's own backups; `backups` inside the data folder when not set. Put it on another disk if you can.              |
| `WARDARR_SECRET_KEY`      | generated | 32-byte key (base64 or hex) that encrypts stored credentials. Generated on first start and kept in the data folder when not set. |
| `WARDARR_PUBLIC_URL`      | none      | Address you open Wardarr at, for links in notifications.                                                                         |
| `WARDARR_TRUST_PROXY`     | `false`   | Trust `X-Forwarded-*` headers. Turn on behind a reverse proxy.                                                                   |
| `WARDARR_COOKIE_SECURE`   | `auto`    | Secure flag on the session cookie; `auto` sets it for HTTPS requests.                                                            |
| `WARDARR_HTTP_TIMEOUT_MS` | `10000`   | Timeout for calls to your services.                                                                                              |
| `WARDARR_LOG_LEVEL`       | `info`    | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`.                                                                  |
| `WARDARR_TRASH_DIR`       | none      | Local checkout of the TRaSH Guides, used instead of downloading them from GitHub.                                                |

### Behind a reverse proxy

Serve Wardarr on its own (sub)domain, set `WARDARR_TRUST_PROXY=true` and, for notification
links, `WARDARR_PUBLIC_URL`. Wardarr does not need WebSockets; live updates use
server-sent events, so turn off response buffering for `/api/events` if your proxy buffers.

## Security and privacy

- Every page and API call needs a login, except the login, the setup wizard and `/healthz`.
- Passwords are hashed with Argon2id. API keys and tokens are encrypted with AES-256-GCM,
  never sent back to the browser and masked in logs.
- Only admins can add services. Wardarr refuses addresses that point at cloud metadata or
  link-local ranges and never forwards credentials on redirects. Your LAN is fine.
- The container runs as an unprivileged user.
- No telemetry, no analytics, no calls home. Posters are loaded through Wardarr, so the poster
  host never sees who is looking.

Found a vulnerability? Please read [SECURITY.md](SECURITY.md).

## Guides

- [Queue Cleaner](docs/guide/queue-cleaner.md): rules, defaults and why to switch off other
  queue cleaners before arming it.
- [Hunting](docs/guide/hunting.md): pace, limits and results.
- [Discover and requests](docs/guide/discover-and-requests.md): how requests reach Seerr and
  how users are linked.
- [TRaSH Guides](docs/guide/trash-guides.md): templates, previews, rollbacks and the guard.
- [Storage](docs/guide/storage.md): how disks are counted and how the forecast works.
- [Library and indexers](docs/guide/library.md): what is counted and how often.
- [Indexer insights](docs/guide/indexer-insights.md): sources, the score and what is stored.
- [Stack map](docs/guide/stack-map.md): how Wardarr draws your stack from what the services report.
- [Backups](docs/guide/backups.md): smart retention, restoring and moving to a new server.
- [Calendar](docs/guide/calendar.md): what the calendar shows and how the iCal link stays private.
- [Tdarr](docs/guide/tdarr.md): what Wardarr reads from Tdarr and when it raises an issue.
- [Notifications](docs/guide/notifications.md): channels, events and the webhook format.
- [Writing an adapter](docs/guide/adapters.md): add support for another service.
- [Live demo](docs/demo.md): how the demo is built and why its films are public domain.
- [Design decisions](docs/decisions/): why Wardarr works the way it does.

## Development

Requirements: Node.js 24, pnpm 10, gitleaks and exiftool.

```sh
pnpm install
pnpm dev
```

`pnpm lint`, `pnpm typecheck`, `pnpm test` and, after `pnpm build`, `pnpm test:e2e` run the
checks. A local setup with invented services lives in [testbed/](testbed/README.md). Read
[CONTRIBUTING.md](CONTRIBUTING.md) before you open a pull request; the
[privacy guard](docs/privacy-guard.md) explains the hooks that keep personal data out of the
repository, and [docs/DESIGN.md](docs/DESIGN.md) how Wardarr looks, moves and speaks.

The screenshots in this README come from the demo build, so they never show a real library:
`pnpm --filter @wardarr/web build:demo && node scripts/screenshots/capture.mjs`.

## License

[MIT](LICENSE). Copyright The Wardarr Authors.

Wardarr is not affiliated with Sonarr, Radarr, Prowlarr, Seerr, Tdarr, Jellyfin, Plex, Emby or any
other project it connects to. Their logos belong to those projects and are used under their own
licenses, listed in [NOTICE.md](NOTICE.md).
