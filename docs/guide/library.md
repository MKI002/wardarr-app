# Library and indexers

## Library

The library page counts what your media servers (Jellyfin, Emby, Plex) hold:
titles, size, resolutions and video codecs per library. Counting reads every
item, so Wardarr does it every six hours or when you press **Count again**.
If a count fails, the last good numbers stay and an issue tells you why.

Wardarr also records what is watched while it runs: plays per day, the most
watched titles and, for admins, plays per person and the latest plays.
Everyone else sees the shared totals without names.

## Indexers

The indexer page lists every indexer in Prowlarr with its status, queries,
grabs, failure rate and response time. Test an indexer right there, or open
it in Prowlarr. The apps section shows which *arr apps receive which
indexers, and a failing indexer names the apps that are left without any
working one.
