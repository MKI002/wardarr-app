# 0007: Product logos

Status: accepted

## Real logos where the license allows it

Each service is easier to find with its own logo, so the overview, the
settings and the setup wizard show it next to the name. Most of the supported
products are open source and ship their logo in their repository under the
project's license (GPL for the \*arr apps, SABnzbd, NZBGet, qBittorrent,
Transmission, Deluge and Bazarr; CC BY-SA 4.0 for Jellyfin; MIT for Seerr). Those files are
taken unchanged from the upstream repositories, with editor metadata removed,
and listed in [NOTICE.md](../../NOTICE.md) with their source and license. The
license texts are in `licenses/` and are copied into the container image.

The logos refer to the products only. They are never used as Wardarr's own
mark, and the README and NOTICE say that Wardarr is not affiliated with these
projects.

## Plex and Emby

Plex and Emby are not open source today, but both published their logos in
their own repositories under the GPL in the past (Plex Media Player and the
last open-source Emby server), and Plex's trademark terms allow the logo for
showing compatibility with a trademark notice. Both logos come from those
repositories, and NOTICE.md carries the trademark notices.

## A neutral mark for anything else

A product without a logo file gets a neutral square with its initial, so new
adapters work before anyone has checked a logo's license.

## Bundled, not fetched

The logos are part of the web bundle (`apps/web/src/assets/logos/`), so they
get hashed file names and long caching, work offline and never cause a request
to a third-party host.

## A dark plate for dark-only logos

Some logos are drawn for a dark header (Radarr's has white outlines). In the
light theme they sit on a small dark plate so they stay recognisable.
