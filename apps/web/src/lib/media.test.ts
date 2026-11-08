import { describe, expect, it } from 'vitest';
import { posterUrl } from './media';

describe('posterUrl', () => {
  it('routes TMDB paths through the sized proxy', () => {
    expect(posterUrl('/abc123.jpg', 'w185')).toBe('/api/images/tmdb/w185/abc123.jpg');
  });

  it('routes TheTVDB artwork through its own proxy', () => {
    expect(posterUrl('tvdb:/banners/v4/series/9007/posters/abc123.jpg')).toBe(
      '/api/images/tvdb/banners/v4/series/9007/posters/abc123.jpg',
    );
  });

  it('drops anything else', () => {
    expect(posterUrl('tvdb:/banners/../x.jpg')).toBeNull();
    expect(posterUrl('tvdb:banners/posters/1.jpg')).toBeNull();
    expect(posterUrl('/a/b.jpg')).toBeNull();
    expect(posterUrl(null)).toBeNull();
  });
});
