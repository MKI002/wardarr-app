// In-memory profile settings of an invented Sonarr or Radarr: custom formats,
// quality profiles, quality definitions and naming. Validates writes the way
// the real API does (unique names, every profile lists every custom format,
// the cutoff must be an allowed quality), so the TRaSH Guides sync meets the
// same errors as against a real service. Used by the end-to-end mocks and the
// demo services.

const QUALITIES = {
  radarr: [
    'Unknown',
    'SDTV',
    'DVD',
    'HDTV-720p',
    'WEBDL-720p',
    'WEBRip-720p',
    'Bluray-720p',
    'HDTV-1080p',
    'WEBDL-1080p',
    'WEBRip-1080p',
    'Bluray-1080p',
    'Remux-1080p',
    'HDTV-2160p',
    'WEBDL-2160p',
    'WEBRip-2160p',
    'Bluray-2160p',
    'Remux-2160p',
    'BR-DISK',
  ],
  sonarr: [
    'Unknown',
    'SDTV',
    'DVD',
    'HDTV-720p',
    'WEBDL-720p',
    'WEBRip-720p',
    'Bluray-720p',
    'HDTV-1080p',
    'WEBDL-1080p',
    'WEBRip-1080p',
    'Bluray-1080p',
    'Bluray-1080p Remux',
    'HDTV-2160p',
    'WEBDL-2160p',
    'WEBRip-2160p',
    'Bluray-2160p',
    'Bluray-2160p Remux',
  ],
};

const LANGUAGES = [
  { id: -2, name: 'Original' },
  { id: -1, name: 'Any' },
  { id: 1, name: 'English' },
  { id: 4, name: 'German' },
];

const clone = (v) => JSON.parse(JSON.stringify(v));
const resolution = (name) => Number(name.match(/(\d{3,4})p/)?.[1] ?? 0);

/**
 * @param {'radarr' | 'sonarr'} product
 * @param {string[]} profileNames existing quality profiles, ids from 1
 */
export function createProfileStore(product, profileNames = ['Any']) {
  let nextId = 100;
  const qualities = QUALITIES[product].map((name, i) => ({
    id: i,
    name,
    source: name.split('-')[0].toLowerCase(),
    resolution: resolution(name),
  }));
  const definitions = qualities.map((q, i) => ({
    id: i + 1,
    quality: clone(q),
    title: q.name,
    minSize: 0,
    maxSize: product === 'radarr' ? 400 : 1000,
    preferredSize: product === 'radarr' ? 300 : 995,
  }));
  const state = {
    formats: [],
    profiles: [],
    definitions,
    naming:
      product === 'radarr'
        ? {
            id: 1,
            renameMovies: false,
            movieFolderFormat: '{Movie Title} ({Release Year})',
            standardMovieFormat: '{Movie Title} ({Release Year}) {Quality Full}',
          }
        : {
            id: 1,
            renameEpisodes: false,
            seriesFolderFormat: '{Series Title}',
            seasonFolderFormat: 'Season {season}',
            standardEpisodeFormat: '{Series Title} - S{season:00}E{episode:00} - {Episode Title}',
            dailyEpisodeFormat: '{Series Title} - {Air-Date} - {Episode Title}',
            animeEpisodeFormat: '{Series Title} - S{season:00}E{episode:00} - {Episode Title}',
          },
  };

  const schema = () => ({
    id: 0,
    name: '',
    upgradeAllowed: false,
    cutoff: 0,
    items: qualities.map((q) => ({ quality: clone(q), items: [], allowed: false })),
    minFormatScore: 0,
    cutoffFormatScore: 0,
    minUpgradeFormatScore: 1,
    formatItems: state.formats.map((f) => ({ format: f.id, name: f.name, score: 0 })),
    ...(product === 'radarr' ? { language: { id: -1, name: 'Any' } } : {}),
  });
  for (const [i, name] of profileNames.entries()) {
    const p = schema();
    p.id = i + 1;
    p.name = name;
    p.items = p.items.map((it) => ({ ...it, allowed: true }));
    state.profiles.push(p);
  }

  const error = (message) => ({ status: 400, body: [{ propertyName: '', errorMessage: message }] });
  const validateProfile = (p) => {
    if (!p.name) return error('Name must not be empty');
    const ids = new Set((p.formatItems ?? []).map((f) => f.format));
    if (ids.size !== state.formats.length || state.formats.some((f) => !ids.has(f.id)))
      return error('All Custom Formats and no extra ones need to be present');
    const allowed = (p.items ?? []).filter((i) => i.allowed).map((i) => (i.quality ? i.quality.id : i.id));
    if (!allowed.includes(p.cutoff)) return error('Cutoff must be an allowed quality or group');
    return null;
  };

  /** Quality of a release title, close enough for the release test. */
  const parseQuality = (title) => {
    const res = title.match(/(2160|1080|720)p/i)?.[1];
    if (!res) return 'Unknown';
    const remux = /remux/i.test(title);
    if (/web-?dl/i.test(title)) return `WEBDL-${res}p`;
    if (/webrip/i.test(title)) return `WEBRip-${res}p`;
    if (/blu-?ray/i.test(title))
      return remux ? (product === 'radarr' ? `Remux-${res}p` : `Bluray-${res}p Remux`) : `Bluray-${res}p`;
    if (/hdtv/i.test(title)) return `HDTV-${res}p`;
    return `WEBDL-${res}p`;
  };
  const matches = (cf, title) =>
    cf.specifications.some((s) => {
      const v = (s.fields ?? []).find((x) => x.name === 'value')?.value;
      if (s.implementation !== 'ReleaseTitleSpecification' || typeof v !== 'string') return false;
      try {
        return new RegExp(v, 'i').test(title) !== Boolean(s.negate);
      } catch {
        return false;
      }
    });

  /**
   * Answers a request to the API, or returns null when the path is not one
   * of the profile settings. `p` is the path below the API prefix.
   */
  function handle(method, p, url, body) {
    const [, resource, sub] = p.split('/');
    const id = Number(sub);
    const ok = (b, status = 200) => ({ status, body: clone(b) });

    if (resource === 'customformat') {
      if (method === 'GET' && !sub) return ok(state.formats);
      if (method === 'POST' && !sub) {
        if (!body?.name) return error('Name must not be empty');
        if (state.formats.some((f) => f.name.toLowerCase() === body.name.toLowerCase()))
          return error('Must be unique');
        const created = { ...clone(body), id: nextId++ };
        state.formats.push(created);
        for (const prof of state.profiles)
          prof.formatItems.push({ format: created.id, name: created.name, score: 0 });
        return ok(created, 201);
      }
      const i = state.formats.findIndex((f) => f.id === id);
      if (i < 0) return { status: 404, body: { message: 'Not found' } };
      if (method === 'PUT') {
        state.formats[i] = { ...clone(body), id };
        for (const prof of state.profiles)
          for (const fi of prof.formatItems) if (fi.format === id) fi.name = body.name;
        return ok(state.formats[i], 202);
      }
      if (method === 'DELETE') {
        state.formats.splice(i, 1);
        for (const prof of state.profiles) prof.formatItems = prof.formatItems.filter((f) => f.format !== id);
        return ok({});
      }
    }

    if (resource === 'qualityprofile') {
      if (method === 'GET' && sub === 'schema') return ok(schema());
      if (method === 'GET' && !sub) return ok(state.profiles);
      if (method === 'POST' && !sub) {
        const created = { ...clone(body ?? {}), id: nextId++ };
        const invalid = validateProfile(created);
        if (invalid) return invalid;
        state.profiles.push(created);
        return ok(created, 201);
      }
      const i = state.profiles.findIndex((x) => x.id === id);
      if (i < 0) return { status: 404, body: { message: 'Not found' } };
      if (method === 'PUT') {
        const next = { ...clone(body ?? {}), id };
        const invalid = validateProfile(next);
        if (invalid) return invalid;
        state.profiles[i] = next;
        return ok(next, 202);
      }
      if (method === 'DELETE') {
        state.profiles.splice(i, 1);
        return ok({});
      }
    }

    if (resource === 'qualitydefinition') {
      if (method === 'GET' && !sub) return ok(state.definitions);
      if (method === 'PUT' && sub === 'update') {
        for (const d of body ?? []) {
          const i = state.definitions.findIndex((x) => x.id === d.id);
          if (i >= 0) state.definitions[i] = clone(d);
        }
        return ok(state.definitions, 202);
      }
    }

    if (resource === 'config' && sub === 'naming') {
      if (method === 'GET') return ok(state.naming);
      if (method === 'PUT') {
        state.naming = { ...clone(body ?? {}), id: 1 };
        return ok(state.naming, 202);
      }
    }

    if (resource === 'language' && method === 'GET' && !sub) return ok(LANGUAGES);

    if (resource === 'parse' && method === 'GET') {
      const title = url.searchParams.get('title') ?? '';
      const info = {
        quality: { quality: { name: parseQuality(title) } },
        languages: [{ name: /german/i.test(title) ? 'German' : 'English' }],
        releaseGroup: title.includes('-') ? title.split('-').pop() : null,
      };
      return ok({
        title,
        [product === 'radarr' ? 'parsedMovieInfo' : 'parsedEpisodeInfo']: info,
        customFormats: state.formats
          .filter((f) => matches(f, title))
          .map((f) => ({ id: f.id, name: f.name })),
      });
    }
    return null;
  }

  return { state, handle };
}
