# Gatekeeper

Some files never belong in a TV or film release: programs, scripts, shortcuts and odd archive
formats. A release that contains one is almost always fake or malware. The Gatekeeper page keeps
one list of such file extensions, writes it into your download clients and *arr apps, and shows
which indexers keep sending them.

## Where to block

| Service     | What Wardarr sets                                                                | When it acts                             |
| ----------- | -------------------------------------------------------------------------------- | ---------------------------------------- |
| SABnzbd     | Config → Switches → Unwanted extensions (`unwanted_extensions`), plus the action | while downloading, before the file lands |
| qBittorrent | Options → Downloads → Excluded file names (`*.exe` patterns)                     | the file is skipped in the torrent       |
| Sonarr      | per indexer: "Fail downloads" with executables and dangerous files               | at import                                |
| Radarr      | the same as Sonarr                                                               | at import                                |

The **download client** is the recommended place. It stops the file before it is on your disk,
and SABnzbd's "abort" removes the job at once, so the *arr app searches for another release
right away.

The *arr apps only see the files at import. Sonarr v4 and Radarr also cannot hold a list of their
own: they know two fixed groups (executables: bat, cmd, exe, sh; potentially dangerous: arj, lnk,
lzh, ps1, scr, vbs, zipx) that can be switched on per indexer. Wardarr switches on the groups that
cover your list, and the page shows the app as **partly**, with the extensions it cannot block.
Sonarr v5 has a free list as well (Media management → "User rejected extensions"); Wardarr fills
it when it is there.

Lidarr, NZBGet, Transmission and Deluge have no way to block file extensions. Block them in a
download client in front of them instead.

## What Wardarr changes

Wardarr adds the extensions on your list and takes away only those it added itself. Entries you
added by hand in a service stay, even when you remove the same extension from Wardarr's list.
Switching a service off removes Wardarr's entries there and leaves yours.

Wardarr does not change two things on purpose:

- SABnzbd in **whitelist** mode (only listed types are allowed). Turning that into a block list
  would change what SABnzbd lets through. The page shows the service as "not possible".
- qBittorrent patterns that are not plain `*.ext`, such as `sample*`. They stay as they are.

A Prowlarr full sync rewrites the indexers of the *arr apps and can drop the "fail downloads"
setting. With **Keep the list in place** on, Wardarr checks every 15 minutes and writes the list
again when a service lost it.

## Searching again after a block

A blocked download is only replaced when the *arr app puts the release on its blocklist and
searches for another one. That is Sonarr's and Radarr's own **Failed Download Handling**
(Settings → Download Clients → Redownload Failed), and it covers both a download that SABnzbd
aborted and one the app failed itself. The page lists every *arr app where it is off and switches
it on with one click. Completed Download Handling must be on as well, or the app never notices
the failure; Wardarr only points that out.

qBittorrent skips the blocked file and finishes the rest. A fake that held nothing but the
blocked file then has nothing to import and stays in the queue; the Queue Cleaner removes it.

## Blocked downloads

Every 15 minutes Wardarr reads what was blocked:

- SABnzbd: failed jobs in the history with "unwanted extension". The history does not say which
  file it found; SABnzbd names it only in its warnings list, which holds the last 20 warnings and
  is cleared on restart. Wardarr reads that list every two minutes and shows the file name (for
  example `sample.exe`) next to the download. A block whose warning was gone before Wardarr read
  it shows up as **file not named** and counts as **type unknown** on the map.
- qBittorrent: files of new torrents that were skipped because of a pattern on the list, by name.
- Sonarr and Radarr: failed downloads whose message names an executable or dangerous file, and
  queue items that are held for the same reason.

The first read goes 30 days back. The same download seen by several services is counted once.
Wardarr finds the indexer through the grab history of the *arr apps (the download id), so a
download that was not grabbed by an *arr app has no indexer.

## The analysis map

The map draws each indexer on the left and the file types on the right; a ribbon's thickness is
the number of blocked downloads. Under each indexer is the share of its grabs that were blocked.
Point at an indexer or a file type to follow its ribbons; on a phone the map turns into a list.

## Effect on the indexer score

Once the gatekeeper is on, the [indexer score](indexer-insights.md#the-score) gets a sixth part,
**clean grabs**, weighted 15 %:

```
clean = max(0, 1 − 5 × blocked / grabs)
```

An indexer with 2 % of its grabs blocked keeps 90 % of this part, one with 20 % or more loses it
completely. It needs at least three grabs in the time frame. The page shows each indexer's score
with and without this part, so you can see who gains and who loses. Indexers with two or more
blocked downloads also show up under "Worth a look" on the indexer insights page.

Before the gatekeeper is switched on, the score stays exactly as it was.
