// Posters from *arr image lists, as paths for Wardarr's image proxy.
import { describe, expect, it } from 'vitest';
import { arrPoster } from '../src/arr/families.js';

const poster = (remoteUrl: string) => [{ coverType: 'poster', remoteUrl }];

describe('arrPoster', () => {
  it('keeps TMDB posters as plain paths', () => {
    expect(arrPoster(poster('https://image.tmdb.org/t/p/original/abc123.jpg'))).toBe('/abc123.jpg');
  });

  it('marks TheTVDB artwork, old and new layout', () => {
    expect(arrPoster(poster('https://artworks.thetvdb.com/banners/v4/series/9007/posters/5f1a2b.jpg'))).toBe(
      'tvdb:/banners/v4/series/9007/posters/5f1a2b.jpg',
    );
    expect(arrPoster(poster('https://artworks.thetvdb.com/banners/posters/9007-3.jpg'))).toBe(
      'tvdb:/banners/posters/9007-3.jpg',
    );
  });

  it('prefers TMDB and ignores fanart, other hosts and odd paths', () => {
    expect(
      arrPoster([
        { coverType: 'poster', remoteUrl: 'https://artworks.thetvdb.com/banners/posters/9007-3.jpg' },
        { coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/original/abc123.jpg' },
      ]),
    ).toBe('/abc123.jpg');
    expect(
      arrPoster([{ coverType: 'fanart', remoteUrl: 'https://artworks.thetvdb.com/banners/fanart/1.jpg' }]),
    ).toBe(null);
    expect(arrPoster(poster('https://artworks.example.test/poster.jpg'))).toBe(null);
    expect(arrPoster(poster('https://artworks.thetvdb.com/banners/../secret.jpg'))).toBe(null);
    expect(arrPoster(poster('http://artworks.thetvdb.com/banners/posters/9007-3.jpg'))).toBe(null);
    expect(arrPoster(null)).toBe(null);
  });
});
