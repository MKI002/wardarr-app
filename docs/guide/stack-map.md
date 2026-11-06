# Stack map

The **Map** tab draws your whole stack as one picture: every connected
instance, the lines between them and where your media lives. Nothing on it is
configured in Wardarr. Each line comes from something a service reports about
another one, so the map shows your setup as it really is, with one instance or
with twenty.

## Columns

From left to right (top to bottom on a phone), the map follows a title on its
way to the screen:

| Column            | Services                                  |
| ----------------- | ----------------------------------------- |
| Requests and feed | Seerr, Prowlarr, Bazarr                   |
| Library managers  | Sonarr, Radarr, Lidarr, Readarr, Whisparr |
| Download clients  | qBittorrent, SABnzbd, Transmission, ...   |
| Storage           | disks, put together from folders          |
| Media servers     | Jellyfin, Plex, Emby, Tdarr               |

Empty columns are left out. A column with more services than fit side by side
on a phone wraps into several rows.

## Where the lines come from

| Line                        | Read from                                                     |
| --------------------------- | ------------------------------------------------------------- |
| Prowlarr → \*arr app        | Prowlarr's apps (`/applications`), with the synced indexers   |
| Seerr → Radarr, Sonarr      | Seerr's server settings                                       |
| Seerr → media server        | Seerr's Plex or Jellyfin settings                             |
| Bazarr → Sonarr, Radarr     | Bazarr's settings, when the connection is switched on         |
| \*arr app → download client | the app's download clients (`/downloadclient`)                |
| \*arr app → media server    | the app's Plex or Emby/Jellyfin connection (`/notification`)  |
| \*arr app → storage         | root folders (`/rootfolder`) and disks (`/diskspace`)         |
| download client → storage   | the default save folder and the free space the client reports |
| storage → media server      | the folders of each library                                   |
| storage → Tdarr             | the folder of each Tdarr library                              |

Wardarr then matches each reported address to a connected instance: the same
host and port first, then the same name, then being the only instance of that
product. Container names such as `http://sonarr:8989` therefore still find the
Sonarr you added as `http://192.0.2.10:8989`. A line Wardarr had to infer
(only one instance of the product, or a library matched by media type) is
dotted.

A service that another one uses but that is not connected to Wardarr shows up
as a dashed **ghost**, with the address it was found at, so you can add it.

## Storage

Folders on the same disk are put together into one storage node. Wardarr
knows they share a disk when the size and free space the services report
agree. Media servers usually see the same folders under other paths, so their
libraries are matched to root folders by the end of the path (`/data/media/tv`
and `/tv` share `tv`), or, when no path matches, by media type. The ring around
a storage node shows how full the disk is; it turns amber below 10 % free and
red below 3 % or when a service cannot reach a folder.

## Live status

The rings around the nodes show the status of the last poll. Downloads in
progress run along their line, media servers with streams pulse, and the
second line under each node says what it is doing right now. Neighbours are
read again every five minutes or with **Read again**; status updates with
every poll.

Click a node for its details: version, live figures, every connection with
how Wardarr found it, the folders on a storage node and links to the matching
tabs. The **List** view shows the same connections as a table.

The map and its API (`GET /api/topology`) are for admins, because they list
addresses and folders of your services.
