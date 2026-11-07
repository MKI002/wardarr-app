# Third-party notices

Wardarr itself is released under the [MIT license](LICENSE). The files listed here are not
part of that grant: they keep the license of the project they come from.

## Product logos

Wardarr shows the logo of each service next to its name so you can tell your instances apart
at a glance. The logos are the trademarks or brand marks of their projects. They are used
only to refer to those products, unchanged apart from removed editor metadata, and Wardarr is
not affiliated with, sponsored or endorsed by any of these projects.

The files live in [`apps/web/src/assets/logos/`](apps/web/src/assets/logos/).

| File               | Product      | Source (project repository, file)                                                                                                | License                                                                |
| ------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `sonarr.svg`       | Sonarr       | [Sonarr](https://github.com/Sonarr/Sonarr), `frontend/src/Content/Images/logo.svg`                                               | [GPL-3.0](licenses/GPL-3.0.txt)                                        |
| `radarr.svg`       | Radarr       | [Radarr](https://github.com/Radarr/Radarr), `frontend/src/Content/Images/logo.svg`                                               | [GPL-3.0](licenses/GPL-3.0.txt)                                        |
| `lidarr.svg`       | Lidarr       | [Lidarr](https://github.com/Lidarr/Lidarr), `frontend/src/Content/Images/logo.svg`                                               | [GPL-3.0](licenses/GPL-3.0.txt)                                        |
| `readarr.svg`      | Readarr      | [Readarr](https://github.com/Readarr/Readarr), `frontend/src/Content/Images/logo.svg`                                            | [GPL-3.0](licenses/GPL-3.0.txt)                                        |
| `whisparr.svg`     | Whisparr     | [Whisparr](https://github.com/Whisparr/Whisparr), `frontend/src/Content/Images/logo.svg`                                         | [GPL-3.0](licenses/GPL-3.0.txt)                                        |
| `prowlarr.svg`     | Prowlarr     | [Prowlarr](https://github.com/Prowlarr/Prowlarr), `frontend/src/Content/Images/logo.svg`                                         | [GPL-3.0](licenses/GPL-3.0.txt)                                        |
| `bazarr.png`       | Bazarr       | [Bazarr](https://www.bazarr.media) repository, `frontend/public/images/logo128.png`                                              | [GPL-3.0](licenses/GPL-3.0.txt)                                        |
| `sabnzbd.svg`      | SABnzbd      | [SABnzbd](https://github.com/sabnzbd/sabnzbd), `icons/logo-arrow.svg`                                                            | [GPL-2.0 or later](licenses/GPL-2.0.txt)                               |
| `nzbget.svg`       | NZBGet       | [NZBGet](https://github.com/nzbgetcom/nzbget), `webui/img/nzbget.svg`                                                            | [GPL-2.0 or later](licenses/GPL-2.0.txt)                               |
| `qbittorrent.svg`  | qBittorrent  | [qBittorrent](https://github.com/qbittorrent/qBittorrent), `src/icons/qbittorrent-tray.svg`                                      | [GPL-2.0 or later](licenses/GPL-2.0.txt)                               |
| `transmission.svg` | Transmission | [Transmission](https://github.com/transmission/transmission), `icons/hicolor_apps_scalable_transmission.svg`                     | [GPL-2.0 or GPL-3.0](licenses/GPL-2.0.txt)                             |
| `deluge.png`       | Deluge       | [Deluge](https://github.com/deluge-torrent/deluge), `deluge/ui/data/icons/hicolor/128x128/apps/deluge.png`                       | [GPL-3.0](licenses/GPL-3.0.txt) with the OpenSSL exception             |
| `jellyfin.svg`     | Jellyfin     | [jellyfin-ux](https://github.com/jellyfin/jellyfin-ux), `branding/SVG/icon-transparent.svg`                                      | [CC BY-SA 4.0](licenses/CC-BY-SA-4.0.txt), © the Jellyfin contributors |
| `plex.svg`         | Plex         | [Plex Media Player](https://github.com/plexinc/plex-media-player), `resources/images/icon.svg`                                   | [GPL-2.0](licenses/GPL-2.0.txt)                                        |
| `emby.png`         | Emby         | [Emby](https://github.com/MediaBrowser/Emby) (last open-source release), `Emby.Dlna/Images/logo120.png`                          | [GPL-2.0](licenses/GPL-2.0.txt)                                        |
| `tdarr.png`        | Tdarr        | [Tdarr](https://github.com/HaveAGitGat/Tdarr) (Tdarr V1, the last open-source release), `public/favicon.png` at commit `41e9293` | [GPL-3.0](licenses/GPL-3.0.txt)                                        |
| `seerr.svg`        | Seerr        | [Seerr](https://github.com/seerr-team/seerr), `public/os_icon.svg`                                                               | [MIT](licenses/MIT-Seerr.txt), Copyright (c) 2020 sct                  |

The license texts are in [`licenses/`](licenses/). Copyright in each logo stays with the
authors of the project it comes from; see that project's repository for the full list.

Tdarr V2 and later are closed source under their own EULA; Wardarr does not take anything
from them. The logo comes from the Tdarr V1 code, which the repository published under
GPL-3.0 until December 2021.

Use of the Jellyfin logo follows the
[Jellyfin branding guidelines](https://jellyfin.org/docs/general/contributing/branding/): it
names the Jellyfin server Wardarr talks to and is not used as Wardarr's own logo.

### Trademarks

Plex, the Plex logo and Plex Media Server are trademarks of Plex, Inc. Emby and the Emby logo
are trademarks of Emby LLC. Jellyfin, Sonarr, Radarr, Lidarr, Readarr, Whisparr, Prowlarr,
Bazarr, SABnzbd, NZBGet, qBittorrent, Transmission, Deluge, Seerr and Tdarr are names and
marks of their respective projects. They are used here only to show compatibility.

### Products without a logo

An adapter whose product has no file in the logo folder shows the first letter of its name in
a neutral square.

## Adding a logo

Only add a logo whose license allows redistribution, take it from the project's own
repository or brand kit, strip editor metadata (`exiftool -all=` for PNG, no
`sodipodi`/`inkscape` attributes or `<metadata>` in SVG) and add a row to the table above.
