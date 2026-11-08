// Queue states and status messages as each *arr product reports them. The
// release and file names are invented.
import { describe, expect, it } from 'vitest';
import { queueState, statusMessageTexts, type ArrQueueRecord } from '../src/arr/base.js';

const record = (r: Partial<ArrQueueRecord>): ArrQueueRecord => ({ id: 1, ...r });

describe('queue state', () => {
  it('reads blocked and failed imports of Sonarr v4 and Radarr v5', () => {
    expect(
      queueState(
        record({
          status: 'completed',
          trackedDownloadState: 'importBlocked',
          trackedDownloadStatus: 'warning',
        }),
      ),
    ).toBe('importBlocked');
    expect(queueState(record({ status: 'failed', trackedDownloadState: 'failed' }))).toBe('failed');
    expect(queueState(record({ status: 'completed', trackedDownloadState: 'failedPending' }))).toBe('failed');
  });

  it('reads failed imports and downloads of Lidarr and Readarr', () => {
    expect(
      queueState(
        record({
          status: 'completed',
          trackedDownloadState: 'importFailed',
          trackedDownloadStatus: 'warning',
        }),
      ),
    ).toBe('importBlocked');
    expect(queueState(record({ status: 'completed', trackedDownloadState: 'downloadFailed' }))).toBe(
      'failed',
    );
    expect(queueState(record({ status: 'completed', trackedDownloadState: 'downloadFailedPending' }))).toBe(
      'failed',
    );
  });

  it('counts a finished download that waits with a warning as blocked', () => {
    expect(
      queueState(
        record({
          status: 'completed',
          trackedDownloadState: 'importPending',
          trackedDownloadStatus: 'warning',
        }),
      ),
    ).toBe('importBlocked');
    // Without a warning it is the normal short wait before the import.
    expect(
      queueState(
        record({ status: 'completed', trackedDownloadState: 'importPending', trackedDownloadStatus: 'ok' }),
      ),
    ).toBe('importPending');
    expect(queueState(record({ status: 'completed', trackedDownloadState: 'importing' }))).toBe(
      'importPending',
    );
  });

  it('keeps downloads and finished imports as they are', () => {
    expect(queueState(record({ status: 'downloading', trackedDownloadState: 'downloading' }))).toBe(
      'downloading',
    );
    expect(
      queueState(
        record({
          status: 'downloading',
          trackedDownloadState: 'downloading',
          trackedDownloadStatus: 'warning',
        }),
      ),
    ).toBe('warning');
    expect(queueState(record({ status: 'completed', trackedDownloadState: 'imported' }))).toBe('completed');
    expect(queueState(record({ status: 'paused' }))).toBe('paused');
  });
});

describe('status messages', () => {
  it('keeps the reasons of a failed Lidarr import once, before the headline', () => {
    const reasons = [
      'Album match is not close enough: 28.9 % vs 80 % [album, country, label, tracks, unmatched tracks]',
      'Has unmatched tracks',
    ];
    expect(
      statusMessageTexts([
        {
          title: 'One or more tracks expected in this release were not imported or missing from the release',
          messages: [],
        },
        { title: '01-example_artist-intro.flac', messages: reasons },
        { title: '02-example_artist-outro.flac', messages: reasons },
      ]),
    ).toEqual([
      ...reasons,
      'One or more tracks expected in this release were not imported or missing from the release',
    ]);
  });

  it('drops the release name that titles a Sonarr or Radarr message', () => {
    expect(
      statusMessageTexts([
        {
          title: 'Example.Movie.2024.1080p.WEB-DL',
          messages: ['Found matching movie via grab history, but release was matched to movie by ID'],
        },
      ]),
    ).toEqual(['Found matching movie via grab history, but release was matched to movie by ID']);
    expect(statusMessageTexts(undefined)).toEqual([]);
    expect(statusMessageTexts([{ title: ' ', messages: [] }])).toEqual([]);
  });
});
