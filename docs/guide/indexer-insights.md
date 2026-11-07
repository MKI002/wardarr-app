# Indexer insights

The **Indexer insights** tab answers two questions: where does each app get
its indexers from, and how well does every indexer work over time? It sits
next to **Indexers**, which shows the live state; the insights tab keeps the
history.

## Where the indexers come from

Wardarr reads the indexers of every connected Sonarr, Radarr, Lidarr and
Readarr and compares them with Prowlarr: its indexers and the apps it syncs
to. Each app gets one of these modes:

| Mode         | Meaning                                                          |
| ------------ | ---------------------------------------------------------------- |
| Prowlarr     | Every indexer comes from Prowlarr.                               |
| Own indexers | Every indexer was added by hand in the app.                      |
| Mixed        | Some come from Prowlarr, some were added by hand.                |
| No indexers  | The app has none.                                                |
| Not readable | Wardarr could not read the app's indexers (see the error shown). |

An entry counts as synced when its address points at a Prowlarr indexer
(`<prowlarr>/<id>/`), or, when the address is unknown, by the
`Name (Prowlarr)` pattern Prowlarr uses. The Prowlarr application that feeds
an app is found by address first (same host, port and path) and then by name;
an entry for another product is never used, and a tie matches nothing.

The tab points out:

- **duplicates**: the same site twice in one app, synced and added by hand,
  so every search hits it twice;
- **missing** indexers: Prowlarr should sync them (the categories of the
  indexer and the sync categories of the app overlap) but the app lacks them;
- **leftovers**: entries that point at a Prowlarr indexer that no longer
  exists, typical for apps on "add only" sync;
- indexers with RSS and every search switched off;
- Prowlarr applications Wardarr does not know, and entries from a Prowlarr
  that is not connected.

The **Indexers × apps** matrix shows every site against every app. Each state
has its own shape as well as its colour, so it reads without colour too.

## What is measured

Every 15 minutes Wardarr reads the statistics of each Prowlarr per hour:
searches, RSS and automatic searches, grabs, failed searches and grabs, and
the average answer time for searches and grabs. On the first run it fills the
last 30 days (whole days, then hours for the last week). It also records when
an indexer goes down and comes back, and which app searched how often.

From the history of the apps it takes every grab with its indexer, and
whether the download was imported or failed. That gives the share of grabs
that made it into the library and the time from grab to import.

Hourly numbers older than 35 days are folded into days; everything older than
400 days is removed.

## The score

Each indexer gets a score from 0 to 100:

| Part                     | Weight |
| ------------------------ | -----: |
| Successful searches      |   35 % |
| Answer time (log scale)  |   20 % |
| Uptime                   |   25 % |
| Grabs that were imported |   20 % |

Answer times of 400 ms or less count fully, 6 s or more count nothing. Parts
without data are left out and the rest is weighted up. An indexer without
search numbers and without grabs has no score, and a switched off indexer has
no uptime.

Uptime counts from the moment Wardarr first saw the indexer. Before that the
outage strip stays grey.

## Charts

- **Speed and reliability**: answer time against successful searches, bubble
  size by grabs. Top left is best.
- **Comparison table**: sortable by every column; a row opens with its
  trends, outages and the apps that use it.
- **Searches over time**, successful and failed, and **when your apps
  search** by weekday and hour in your time zone.
- **Outages** per indexer and **who searches**: searches per app as Prowlarr
  counts them, and grabs per app from their history.

Time ranges are 24 hours, 7, 30 and 90 days; each number compares with the
range before it.

## Never waiting for a service

Both indexer pages open at once with what Wardarr already has. On the
Indexers page that is the last statistics Prowlarr gave (kept across
restarts); here it is the stored history. Anything newer is read in the
background: each indexer shows a turning arc while its numbers are read, and
the page fills in on its own when they arrive. If Prowlarr is too slow or
unreachable, the older numbers stay, with a note saying how old they are and
a button to try again. Prowlarr adds up its whole history for the all-time
statistics, which can take a while on a large database, so Wardarr gives that
call up to a minute and does not count a slow answer as an outage.

## Access

The tab is for admins. It shows up once Prowlarr or an app with indexers is
connected.
