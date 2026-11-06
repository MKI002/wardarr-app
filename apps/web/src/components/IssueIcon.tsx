// A small icon for what kind of problem an issue is, tinted by severity.
// The kind comes from the rule id at the front of the fingerprint.
import type { Tone } from './ui';

type Kind = 'indexer' | 'download' | 'folder' | 'update' | 'connection' | 'pause' | 'sync' | 'alert';

const RULE_KIND: Record<string, Kind> = {
  'indexer-unavailable': 'indexer',
  'all-indexers-unavailable': 'indexer',
  'indexer-search-unavailable': 'indexer',
  'download-client-unavailable': 'download',
  'downloads-failed': 'download',
  'tracker-errors': 'download',
  'downloader-quota': 'download',
  'cleaner-import-ready': 'download',
  'cleaner-attempts-exhausted': 'download',
  'cleaner-orphaned-downloads': 'download',
  'root-folder-missing': 'folder',
  'remote-path-mapping': 'folder',
  'wardarr-media-cache': 'folder',
  'update-available': 'update',
  'instance-unreachable': 'connection',
  'credentials-rejected': 'connection',
  'wardarr-api-compatibility': 'connection',
  'downloader-offline': 'connection',
  'downloader-port-closed': 'connection',
  'cleaner-paused': 'pause',
  'downloader-paused': 'pause',
  'trash-guide-fetch-failed': 'sync',
  'trash-local-drift': 'sync',
  'trash-guide-drift': 'sync',
  'trash-sync-failed': 'sync',
  'trash-sync-paused': 'pause',
  'trash-unsupported-version': 'connection',
};

const PATHS: Record<Kind, string[]> = {
  indexer: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z', 'm20 20-4-4'],
  download: ['M12 4v11', 'm7 10 5 5 5-5', 'M5 20h14'],
  folder: ['M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z'],
  update: ['M12 19V6', 'm6 11 6-6 6 6'],
  connection: ['M9 7V3', 'M15 7V3', 'M6 7h12v4a6 6 0 0 1-12 0Z', 'M12 17v4'],
  pause: ['M9 6v12', 'M15 6v12'],
  sync: ['M20 11a8 8 0 0 0-14.3-4.9L4 8', 'M4 4v4h4', 'M4 13a8 8 0 0 0 14.3 4.9L20 16', 'M20 20v-4h-4'],
  alert: [
    'M12 8v5',
    'M12 16.5v.5',
    'M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z',
  ],
};

const TINT: Record<Tone, string> = {
  critical: 'bg-critical-bg text-critical',
  warning: 'bg-warning-bg text-warning',
  info: 'bg-info-bg text-info',
  ok: 'bg-ok-bg text-ok',
  neutral: 'bg-surface-2 text-muted',
};

export function issueKind(fingerprint: string): Kind {
  return RULE_KIND[fingerprint.split(':')[0] ?? ''] ?? 'alert';
}

export function IssueIcon({
  fingerprint,
  tone,
  label,
  size = 'md',
}: {
  fingerprint: string;
  tone: Tone;
  label: string;
  size?: 'sm' | 'md';
}) {
  const kind = issueKind(fingerprint);
  return (
    <span
      className={`inline-grid shrink-0 place-items-center rounded-lg ${TINT[tone]} ${size === 'sm' ? 'size-7' : 'size-9'}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <svg
        viewBox="0 0 24 24"
        className={size === 'sm' ? 'size-4' : 'size-5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {PATHS[kind].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}
