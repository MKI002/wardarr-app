# Third-party notices

Wardarr itself is released under the [MIT license](LICENSE). The files listed here are not
part of that grant: they keep the license of the project they come from.

## Product logos

Wardarr shows the logo of each service next to its name so you can tell your instances apart
at a glance. The logos are the trademarks or brand marks of their projects. They are used
only to refer to those products, unchanged apart from removed editor metadata, and Wardarr is
not affiliated with, sponsored or endorsed by any of these projects.

The files live in [`apps/web/src/assets/logos/`](apps/web/src/assets/logos/).

| File               | Product      | Source (project repository, file)                                                                            | License                                                                |
| ------------------ | ------------ | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `sonarr.svg`       | Sonarr       | [Sonarr](https://github.com/Sonarr/Sonarr), `frontend/src/Content/Images/logo.svg`                           | [GPL-3.0](licenses/GPL-3.0.txt)                                        |
| `radarr.svg`       | Radarr       | [Radarr](https://github.com/Radarr/Radarr), `frontend/src/Content/Images/logo.svg`                           | [GPL-3.0](licenses/GPL-3.0.txt)                                        |
| `lidarr.svg`       | Lidarr       | [Lidarr](https://github.com/Lidarr/Lidarr), `frontend/src/Content/Images/logo.svg`                           | [GPL-3.0](licenses/GPL-3.0.txt)                                        |
| `readarr.svg`      | Readarr      | [Readarr](https://github.com/Readarr/Readarr), `frontend/src/Content/Images/logo.svg`                        | [GPL-3.0](licenses/GPL-3.0.txt)                                        |
| `whisparr.svg`     | Whisparr     | [Whisparr](https://github.com/Whisparr/Whisparr), `frontend/src/Content/Images/logo.svg`                     | [GPL-3.0](licenses/GPL-3.0.txt)                                        |
| `prowlarr.svg`     | Prowlarr     | [Prowlarr](https://github.com/Prowlarr/Prowlarr), `frontend/src/Content/Images/logo.svg`                     | [GPL-3.0](licenses/GPL-3.0.txt)                                        |
| `bazarr.png`       | Bazarr       | [Bazarr](https://www.bazarr.media) repository, `frontend/public/images/logo128.png`                          | [GPL-3.0](licenses/GPL-3.0.txt)                                        |
| `sabnzbd.svg`      | SABnzbd      | [SABnzbd](https://github.com/sabnzbd/sabnzbd), `icons/logo-arrow.svg`                                        | [GPL-2.0 or later](licenses/GPL-2.0.txt)                               |
| `nzbget.svg`       | NZBGet       | [NZBGet](https://github.com/nzbgetcom/nzbget), `webui/img/nzbget.svg`                                        | [GPL-2.0 or later](licenses/GPL-2.0.txt)                               |
| `qbittorrent.svg`  | qBittorrent  | [qBittorrent](https://github.com/qbittorrent/qBittorrent), `src/icons/qbittorrent-tray.svg`                  | [GPL-2.0 or later](licenses/GPL-2.0.txt)                               |
| `transmission.svg` | Transmission | [Transmission](https://github.com/transmission/transmission), `icons/hicolor_apps_scalable_transmission.svg` | [GPL-2.0 or GPL-3.0](licenses/GPL-2.0.txt)                             |
| `deluge.png`       | Deluge       | [Deluge](https://github.com/deluge-torrent/deluge), `deluge/ui/data/icons/hicolor/128x128/apps/deluge.png`   | [GPL-3.0](licenses/GPL-3.0.txt) with the OpenSSL exception             |
| `jellyfin.svg`     | Jellyfin     | [jellyfin-ux](https://github.com/jellyfin/jellyfin-ux), `branding/SVG/icon-transparent.svg`                  | [CC BY-SA 4.0](licenses/CC-BY-SA-4.0.txt), © the Jellyfin contributors |

The license texts are in [`licenses/`](licenses/). Copyright in each logo stays with the
authors of the project it comes from; see that project's repository for the full list.

Use of the Jellyfin logo follows the
[Jellyfin branding guidelines](https://jellyfin.org/docs/general/contributing/branding/): it
names the Jellyfin server Wardarr talks to and is not used as Wardarr's own logo.

### Products shown with a neutral mark

| Product | Why there is no logo                                                                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plex    | Plex's trademark terms allow the logo for compatibility with attribution, but the official files are only offered on Plex's brand site and are not open source. |
| Emby    | Emby's code is not open source and there is no published license or brand kit for its logo.                                                                     |
| Seerr   | Pending: the logo is MIT-licensed, and the license requires shipping its copyright line.                                                                        |

These products appear with the first letter of their name in a neutral square.

## Adding a logo

Only add a logo whose license allows redistribution, take it from the project's own
repository or brand kit, strip editor metadata (`exiftool -all=` for PNG, no
`sodipodi`/`inkscape` attributes or `<metadata>` in SVG) and add a row to the table above.
