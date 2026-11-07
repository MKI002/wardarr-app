// Shapes of the stack map API (`GET /api/topology`).
export type MapTone = 'ok' | 'warning' | 'critical' | 'unknown' | 'off';
export type LinkKind =
  'indexers' | 'downloads' | 'requests' | 'subtitles' | 'mediaServer' | 'libraryUpdate' | 'storage';
export type MatchKind = 'address' | 'name' | 'product' | 'path' | 'space' | 'kind' | 'self';

export interface StorageMember {
  instanceId: string;
  path: string;
  use: 'media' | 'downloads' | 'library';
  name?: string;
  kind?: 'movie' | 'show' | 'music' | 'book' | 'other';
  accessible?: boolean;
  match: MatchKind;
}

export interface MapNode {
  id: string;
  type: 'instance' | 'storage';
  layer: number;
  name: string;
  adapter: string | null;
  instanceId?: string;
  storage?: {
    freeBytes: number | null;
    totalBytes: number | null;
    mount: string | null;
    members: StorageMember[];
  };
  status: MapTone;
  adapterName?: string;
  instanceStatus?: 'ok' | 'degraded' | 'down' | 'unknown' | 'disabled';
  version?: string | null;
  checkedAt?: string | null;
  errorKind?: string | null;
  webUrl?: string | null;
  live: {
    downloading?: number;
    speed?: number;
    queue?: number;
    streams?: number;
    transcodes?: number;
    workers?: number;
    nodes?: number;
    indexers?: number;
    failingIndexers?: number;
    issues?: number;
  };
}

export interface MapEdge {
  id: string;
  from: string;
  to: string;
  kind: LinkKind;
  labels: string[];
  enabled: boolean;
  match: MatchKind;
  confident: boolean;
  redundant?: boolean;
  indexerIds?: number[];
  is4k?: boolean;
  use?: StorageMember['use'];
  status: MapTone;
  active?: number;
  failing?: number;
}

export interface StackMap {
  nodes: MapNode[];
  edges: MapEdge[];
  unread: string[];
  readAt: string | null;
}
