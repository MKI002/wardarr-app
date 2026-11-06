# 0010: Indexer insights

Status: accepted

## Own history instead of Prowlarr's totals

Prowlarr keeps statistics, but only as totals over a time window and without
a history of outages. Wardarr stores what it reads in its own tables: hourly
buckets per indexer, the callers per bucket, a status log with every change
between up and down, every grab of the apps with its result, and a daily
count of sources per app. Prowlarr's `indexerstats` accepts a start and end,
so the first run fills 30 days without waiting, and each later run reads only
the hours since the last one, plus the open hour again.

Hours older than 35 days are folded into days, and rows older than 400 days
are deleted, so the database stays small on a long running install.

## Sources are compared, not configured

Wardarr does not ask which apps use Prowlarr. It reads the indexers of every
app and the applications in Prowlarr and matches them: by the address of the
entry (Prowlarr gives synced entries `<prowlarr>/<id>/`), else by name; the
app behind a Prowlarr application by host, port and path, else by name, and
only within the same product. Several apps often share one host behind a
reverse proxy, so a different path never matches on its own, and a tie
matches nothing instead of guessing. A wrong match would hide a real
problem; no match shows the app as "not set up in Prowlarr", which is visible
and easy to check.

Sites are keyed by their Prowlarr indexer when there is one, otherwise by the
normalized name, so an indexer added by hand in two apps is one row.

## One score, explained

A single number makes indexers easy to rank, but only if it is honest. The
score uses four parts with fixed weights, leaves out parts without data and
has no value at all when there is nothing to judge. The answer time is
scored on a log scale because the difference between 300 ms and 1 s matters
more than between 5 and 6 s. The weights are in `SCORE_WEIGHTS` in
`packages/core/src/indexers/analysis.ts` and in the guide.

## Design

The tab follows `docs/DESIGN.md`: status colours only for status, the accent
for amounts, a lighter step of the accent for "added by hand", and every
matrix state has its own shape. The live state stays on the Indexers page;
this tab links back and forth with it.
