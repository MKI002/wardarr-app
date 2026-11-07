# 0011: Indexer priority watchdog

Status: accepted

## Relative scores, rounded to steps

Priorities only order indexers against each other, so the watchdog spreads
the scores over a range instead of mapping a score to a fixed number: the
best indexer gets the first value, the weakest the last. A fixed mapping
would put every indexer at the same priority when all of them work well.
The range (default 10 to 40) leaves room above and below for indexers people
want to pin by hand.

Values are rounded to a step (default 5) and a value that is already on a
step stays while the unrounded target is less than one step away. Without
this, an indexer whose score sits near a boundary would change every day,
and every change in Prowlarr triggers a sync to the apps.

## Write only what changes

The plan compares with the priority read just before the run, and the
adapters read the indexer again and skip the write when the value already
matches. A write sends the full indexer back with `forceSave`, as Prowlarr's
and the apps' own UI do, so masked secrets stay as they are and no indexer
test runs.

## Prowlarr first, apps only where Prowlarr does not reach

Prowlarr passes priorities on only with Full Sync. Writing to an app that
Prowlarr syncs fully would be undone on the next sync, so those entries are
never touched. Entries in apps with "add and remove only" or no sync, and
indexers added by hand, are written only when the admin turns this on: it
changes settings in more places, and some people keep app priorities on
purpose.

## Off, then preview

The watchdog changes settings in other services, so it starts off and in
preview mode. Every run, preview or not, goes into a log with the old and
new value and the error, if any, kept for 180 days.
