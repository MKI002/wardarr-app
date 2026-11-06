import { describe, expect, it } from 'vitest';
import { parseRelease } from './release';

describe('parseRelease', () => {
  it('reads an episode release', () => {
    expect(parseRelease('Lanternfall.S02E01.1080p.WEB.H264')).toEqual({
      title: 'Lanternfall',
      episode: 'S02E01',
      tags: ['1080p', 'WEB', 'H264'],
    });
  });

  it('reads a movie release with a year and drops the group', () => {
    expect(parseRelease('The.Great.Train.Robbery.1903.Restored.2160p.BluRay.x265-GRP.mkv')).toEqual({
      title: 'The Great Train Robbery',
      year: '1903',
      tags: ['4K', 'BluRay', 'x265'],
    });
  });

  it('keeps names it cannot read', () => {
    expect(parseRelease('Some album name')).toEqual({ title: 'Some album name', tags: [] });
  });
});
