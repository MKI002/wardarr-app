# 0004: Discover, requests, library and indexers

Status: accepted

## Requests go through Seerr, as the right user

- Wardarr never talks to Radarr or Sonarr directly for a request. It asks
  Seerr, which keeps its own permissions, quotas, auto-approval and
  notifications in charge.
- Every request carries the `X-API-User` header with the Seerr user that
  belongs to the Wardarr user. Seerr then treats it as that person's request.
- The link between a Wardarr user and a Seerr user is either set by an admin
  (`request_links` table) or matched by name: the Wardarr user name or
  display name against the Seerr user name, display name and the Plex and
  Jellyfin user names. Only a single unambiguous match counts. E-mail
  addresses are never read or stored for this.
- A user without a link cannot request. An admin without a link requests as
  the owner of the API key.
- Users only choose standard or 4K and, when there are several, the server.
  Quality profiles and folders are for admins; the server drops them from
  user requests.

## Posters through Wardarr

Posters load from `/api/images/tmdb/<size>/<file>`. The upstream host is
fixed, sizes come from an allowlist, file names are strictly validated and
redirects are refused, so the route cannot be used to reach other hosts.
TMDB never sees who is looking. The cache is in memory and bounded.

## Stream history in SQLite

Media servers only report what is playing now. Wardarr updates an open play
per session on every poll and closes it when the session is gone. Play time
counts only gaps between polls of at most five minutes while playing, so a
paused or missed poll does not inflate it. Polls that failed to read the
sessions do not touch the history. Plays are kept for a year.

## Library statistics are cached

Counting a library reads every movie and episode, which is slow on large
servers. Wardarr counts every six hours and on demand, keeps the last good
numbers when a count fails, and raises the `wardarr-media-cache` issue on
the `cache` channel when a count fails or the numbers are older than two
days. The issue resolves after the next successful count.

## What users see

- Discover and their own requests.
- Shared statistics: library totals, plays per day and the most watched
  titles. Names of other people, the plays per person and recent plays are
  for admins only.

## Indexers

The indexer page combines the Prowlarr status from the regular poll with
statistics and the synced apps, cached for five minutes. For a failing
indexer it lists the apps that receive it and those left without any
working indexer.
