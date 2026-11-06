// Types and helpers shared by Discover, Requests and Library.
import type { Tone } from '../components/ui';

export type Availability = 'unknown' | 'requested' | 'processing' | 'partial' | 'available';
export type RequestStatus = 'pending' | 'approved' | 'declined' | 'failed' | 'completed';

export interface DiscoverItem {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number | null;
  status: Availability;
  status4k: Availability;
}

export interface DiscoverPage {
  instanceId: string;
  page: number;
  totalPages: number;
  results: DiscoverItem[];
}

export interface DiscoverDetails extends DiscoverItem {
  seasons: Array<{
    seasonNumber: number;
    name: string;
    episodeCount: number;
    status: Availability;
    status4k: Availability;
  }>;
  tvdbId: number | null;
}

export interface RequestServer {
  id: number;
  name: string;
  type: 'radarr' | 'sonarr';
  is4k: boolean;
  isDefault: boolean;
  profiles?: Array<{ id: number; name: string }>;
  rootFolders?: string[];
  defaultProfileId?: number | null;
  defaultRootFolder?: string | null;
}

export interface RequestOptions {
  instanceId: string;
  linked: boolean;
  link: { externalId: number | null; externalName: string | null; source: 'manual' | 'auto' | 'none' };
  servers: RequestServer[];
}

export interface MediaRequest {
  id: number;
  status: RequestStatus;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string | null;
  posterPath: string | null;
  is4k: boolean;
  seasons: number[];
  createdAt: string;
  updatedAt: string | null;
  requestedBy: { id: number; name: string };
  serverId: number | null;
  profileId: number | null;
  rootFolder: string | null;
  mediaStatus: Availability;
}

/** Poster URL through Wardarr's own proxy, so TMDB never sees the viewer. */
export function posterUrl(path: string | null, size: 'w185' | 'w342' | 'w500' = 'w342'): string | null {
  const file = path?.replace(/^\//, '');
  return file && /^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(file)
    ? `/api/images/tmdb/${size}/${file}`
    : null;
}

export const AVAILABILITY_TONE: Record<Availability, Tone> = {
  unknown: 'neutral',
  requested: 'info',
  processing: 'info',
  partial: 'warning',
  available: 'ok',
};

export const REQUEST_TONE: Record<RequestStatus, Tone> = {
  pending: 'warning',
  approved: 'info',
  declined: 'neutral',
  failed: 'critical',
  completed: 'ok',
};
