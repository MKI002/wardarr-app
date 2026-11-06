// All adapters shipped with Wardarr. To add a service, create an adapter
// with `defineAdapter`, add fixtures and a contract test, and list it here.
import type { AdapterDefinition } from '@wardarr/core';
import { lidarr } from './arr/lidarr.js';
import { radarr } from './arr/radarr.js';
import { readarr } from './arr/readarr.js';
import { sonarr } from './arr/sonarr.js';
import { whisparr } from './arr/whisparr.js';
import { deluge } from './downloaders/deluge.js';
import { nzbget } from './downloaders/nzbget.js';
import { qbittorrent } from './downloaders/qbittorrent.js';
import { sabnzbd } from './downloaders/sabnzbd.js';
import { transmission } from './downloaders/transmission.js';
import { prowlarr } from './indexers/prowlarr.js';
import { emby } from './media/emby.js';
import { jellyfin } from './media/jellyfin.js';
import { plex } from './media/plex.js';
import { seerr } from './requests/seerr.js';
import { bazarr } from './subtitles/bazarr.js';
import { tdarr } from './transcoders/tdarr.js';

export const ADAPTERS = [
  sonarr,
  radarr,
  lidarr,
  whisparr,
  bazarr,
  readarr,
  prowlarr,
  sabnzbd,
  nzbget,
  qbittorrent,
  transmission,
  deluge,
  jellyfin,
  plex,
  emby,
  seerr,
  tdarr,
] as unknown as readonly AdapterDefinition<never>[];

export {
  lidarr,
  radarr,
  readarr,
  sonarr,
  whisparr,
  bazarr,
  prowlarr,
  sabnzbd,
  nzbget,
  qbittorrent,
  transmission,
  deluge,
  jellyfin,
  plex,
  emby,
  seerr,
  tdarr,
};
