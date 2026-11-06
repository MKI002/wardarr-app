# 0007: Product logos

Status: accepted

## Real logos where the license allows it

Each service is easier to find with its own logo, so the overview, the
settings and the setup wizard show it next to the name. Most of the supported
products are open source and ship their logo in their repository under the
project's license (GPL for the \*arr apps, SABnzbd, NZBGet, qBittorrent,
Transmission, Deluge and Bazarr; CC BY-SA 4.0 for Jellyfin). Those files are
taken unchanged from the upstream repositories, with editor metadata removed,
and listed in [NOTICE.md](../../NOTICE.md) with their source and license. The
license texts are in `licenses/` and are copied into the container image.

The logos refer to the products only. They are never used as Wardarr's own
mark, and the README and NOTICE say that Wardarr is not affiliated with these
projects.

## A neutral mark for the rest

Plex and Emby are not open source and offer no logo under a license that
allows redistribution from a repository; Seerr's MIT license would require
shipping a copyright line that names a person. These products get a neutral
square with their initial until that changes.

## Bundled, not fetched

The logos are part of the web bundle (`apps/web/src/assets/logos/`), so they
get hashed file names and long caching, work offline and never cause a request
to a third-party host.

## A dark plate for dark-only logos

Some logos are drawn for a dark header (Radarr's has white outlines). In the
light theme they sit on a small dark plate so they stay recognisable.
