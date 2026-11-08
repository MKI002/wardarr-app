// Episode and movie files for the quality score page of the demo. Every file
// gets an invented release (source, codec, HDR, audio, languages, group);
// the custom formats are matched against that release the way Sonarr and
// Radarr would, so the scores follow from the formats and profiles.
//
// The custom formats below are an invented, hand-made set ("Language:
// German", "Codec: AV1", ...). capture.mjs adds them to the demo services
// after the TRaSH Guides demo is set up, next to the formats the TRaSH
// Guides demo synced, and they are scored in each service's first profile.

const DEMO_FORMATS = [
  ['Language: German', [['LanguageSpecification', 4]], { hd: 1000, uhd: 1000 }],
  ['Language: English', [['LanguageSpecification', 1]], { hd: 300, uhd: 300 }],
  ['Audio: Atmos', [['ReleaseTitleSpecification', '\\batmos\\b']], { hd: 300, uhd: 400 }],
  ['Audio: Lossless', [['ReleaseTitleSpecification', '\\b(truehd|dts-?hd|flac)\\b']], { hd: 250, uhd: 300 }],
  ['Audio: DD+', [['ReleaseTitleSpecification', '\\b(ddp|eac3)\\b']], { hd: 150, uhd: 100 }],
  ['Codec: AV1', [['ReleaseTitleSpecification', '\\bav1\\b']], { hd: 250, uhd: 250 }],
  ['Codec: HEVC', [['ReleaseTitleSpecification', '\\b(h\\.?265|x265|hevc)\\b']], { hd: 200, uhd: 200 }],
  ['Codec: x264', [['ReleaseTitleSpecification', '\\b(h\\.?264|x264)\\b']], { hd: 50, uhd: -200 }],
  ['HDR: Dolby Vision', [['ReleaseTitleSpecification', '\\bDV\\b']], { hd: 0, uhd: 600 }],
  ['HDR: HDR10+', [['ReleaseTitleSpecification', '\\bHDR10(\\+|Plus)']], { hd: 0, uhd: 300 }],
  ['HDR: HDR10', [['ReleaseTitleSpecification', '\\bHDR10\\b']], { hd: 0, uhd: 200 }],
  ['Source: Remux', [['ReleaseTitleSpecification', '\\bremux\\b']], { hd: 400, uhd: 500 }],
  ['Source: Bluray', [['ReleaseTitleSpecification', '\\bblu-?ray\\b']], { hd: 250, uhd: 300 }],
  ['Source: WEB-DL', [['ReleaseTitleSpecification', '\\bweb-?dl\\b']], { hd: 200, uhd: 200 }],
  [
    'Reject: LQ Groups',
    [['ReleaseGroupSpecification', '^(BADGROUP|WORSEGROUP)$']],
    { hd: -10000, uhd: -10000 },
  ],
  ['Quality: Repack / Proper', [['ReleaseTitleSpecification', '\\b(repack|proper)\\b']], { hd: 5, uhd: 5 }],
];

/** A small deterministic random number generator, so every capture is the same. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pick = (r, options) => {
  const total = options.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [value, w] of options) if ((x -= w) < 0) return value;
  return options[options.length - 1][0];
};

const LANGS = { ger: { id: 4, name: 'German' }, eng: { id: 1, name: 'English' } };

/** An invented release for one file, with its media info. */
function release(id, uhd) {
  const r = rng(id * 7919 + (uhd ? 17 : 3));
  const source = pick(
    r,
    uhd
      ? [
          ['WEB-DL', 5],
          ['BluRay', 2],
          ['BluRay.REMUX', 2],
        ]
      : [
          ['WEB-DL', 6],
          ['WEBRip', 2],
          ['BluRay', 2],
          ['BluRay.REMUX', 1],
        ],
  );
  const codec = pick(
    r,
    uhd
      ? [
          ['H.265', 7],
          ['AV1', 2],
          ['H.264', 1],
        ]
      : [
          ['H.264', 5],
          ['H.265', 4],
          ['AV1', 1],
        ],
  );
  const hdr = uhd
    ? pick(r, [
        ['DV.HDR10', 3],
        ['HDR10', 3],
        ['HDR10Plus', 1],
        ['', 2],
      ])
    : '';
  const remux = source.includes('REMUX');
  const audio = pick(
    r,
    remux
      ? [
          ['TrueHD.Atmos.7.1', 3],
          ['DTS-HD.MA.5.1', 2],
          ['DDP5.1', 1],
        ]
      : [
          ['DDP5.1.Atmos', 2],
          ['DDP5.1', 5],
          ['AAC2.0', 2],
          ['TrueHD.Atmos.7.1', 1],
        ],
  );
  const langs = pick(r, [
    [['ger', 'eng'], 5],
    [['eng'], 4],
    [['ger'], 1],
  ]);
  const subs = pick(r, [
    [['ger', 'eng'], 4],
    [['eng'], 3],
    [['ger'], 1],
    [[], 2],
  ]);
  const group = pick(r, [
    ['HARBOR', 4],
    ['LANTERN', 3],
    ['MEADOW', 3],
    ['BADGROUP', 1],
  ]);
  const repack = r() < 0.08;
  const res = uhd ? '2160p' : '1080p';
  const title = [
    res,
    source,
    langs.length > 1 ? 'German.DL' : langs[0] === 'ger' ? 'German' : '',
    hdr,
    audio,
    codec,
    repack ? 'REPACK' : '',
  ]
    .filter(Boolean)
    .join('.');
  const audioCodec = audio.startsWith('TrueHD')
    ? 'TrueHD Atmos'
    : audio.startsWith('DTS')
      ? 'DTS-HD MA'
      : audio.startsWith('DDP')
        ? audio.includes('Atmos')
          ? 'EAC3 Atmos'
          : 'EAC3'
        : 'AAC';
  return {
    title: `${title}-${group}`,
    group,
    langs,
    quality: `${remux ? (uhd ? 'Remux-2160p' : 'Remux-1080p') : source === 'WEB-DL' ? `WEBDL-${res}` : source === 'WEBRip' ? `WEBRip-${res}` : `Bluray-${res}`}`,
    resolution: uhd ? 2160 : 1080,
    mediaInfo: {
      videoCodec: codec === 'H.265' ? 'x265' : codec === 'AV1' ? 'AV1' : 'x264',
      videoDynamicRangeType: hdr.replace('.', ' '),
      audioCodec,
      audioChannels: audio.includes('7.1') ? 7.1 : audio.includes('5.1') ? 5.1 : 2,
      audioLanguages: langs.join('/'),
      subtitles: subs.join('/'),
      resolution: uhd ? '3840x2160' : '1920x1080',
    },
  };
}

function specMatches(spec, rel) {
  const value = (spec.fields ?? []).find((f) => f.name === 'value')?.value;
  let hit = false;
  if (spec.implementation === 'ReleaseTitleSpecification' && typeof value === 'string') {
    try {
      hit = new RegExp(value, 'i').test(rel.title);
    } catch {
      hit = false;
    }
  } else if (spec.implementation === 'ReleaseGroupSpecification' && typeof value === 'string') {
    hit = new RegExp(value, 'i').test(rel.group);
  } else if (spec.implementation === 'LanguageSpecification') {
    hit = rel.langs.some((l) => LANGS[l]?.id === value) || (value === -2 && rel.langs.includes('eng'));
  } else if (spec.implementation === 'ResolutionSpecification') {
    hit = value === rel.resolution;
  }
  return spec.negate ? !hit : hit;
}

/** Custom formats a release matches: every required condition, and one of the others if there are any. */
function matchFormats(formats, rel) {
  return formats
    .filter((f) => {
      const specs = f.specifications ?? [];
      if (specs.length === 0) return false;
      const required = specs.filter((s) => s.required);
      const optional = specs.filter((s) => !s.required);
      return (
        required.every((s) => specMatches(s, rel)) &&
        (optional.length === 0 || optional.some((s) => specMatches(s, rel)))
      );
    })
    .map((f) => ({ id: f.id, name: f.name }));
}

const seeded = new WeakSet();

/** Adds the demo formats to a service once and scores them in its first profile. */
export function seedQualityFormats(store, uhd) {
  if (seeded.has(store)) return;
  seeded.add(store);
  let nextId = 500;
  const profile = store.state.profiles.find((p) => p.id === 1);
  for (const [name, specs, scores] of DEMO_FORMATS) {
    const id = nextId++;
    store.state.formats.push({
      id,
      name,
      includeCustomFormatWhenRenaming: false,
      specifications: specs.map(([implementation, value]) => ({
        name,
        implementation,
        negate: false,
        required: false,
        fields: [{ name: 'value', value }],
      })),
    });
    for (const p of store.state.profiles)
      p.formatItems.push({ format: id, name, score: p === profile ? scores[uhd ? 'uhd' : 'hd'] : 0 });
  }
  if (profile) {
    profile.upgradeAllowed = true;
    profile.cutoffFormatScore = uhd ? 2600 : 2000;
    profile.minFormatScore = 0;
  }
}

function fileOf(id, rel, formats, extra) {
  const matched = matchFormats(formats, rel);
  return {
    id,
    ...extra,
    relativePath: `${rel.title}.mkv`,
    sceneName: rel.title,
    size: Math.round((rel.resolution === 2160 ? 9 : 3) * 1024 ** 3 * (0.6 + (id % 7) / 10)),
    quality: { quality: { id: 1, name: rel.quality, resolution: rel.resolution }, revision: { version: 1 } },
    languages: rel.langs.map((l) => LANGS[l]),
    mediaInfo: rel.mediaInfo,
    customFormats: matched,
    customFormatScore: null,
  };
}

/** Episode files of one series: whole seasons that are out, half of the one airing. */
export function episodeFiles(store, uhd, seriesId, seasons) {
  const files = [];
  for (const season of seasons) {
    const count = season.status === 5 ? season.episodes : Math.ceil(season.episodes / 2);
    for (let ep = 1; ep <= count; ep++) {
      const id = seriesId * 1000 + season.n * 100 + ep;
      const rel = release(id, uhd);
      const file = fileOf(id, rel, store.state.formats, { seriesId, seasonNumber: season.n });
      file.customFormatScore = scoreOf(store, file.customFormats);
      files.push(file);
    }
  }
  return files;
}

/** Movie files by id, for `/moviefile?movieFileIds=...`. */
export function movieFiles(store, uhd, movies, fileIds) {
  return movies
    .filter((m) => m.movieFileId && fileIds.includes(m.movieFileId))
    .map((m) => {
      const rel = release(m.movieFileId, uhd);
      const file = fileOf(m.movieFileId, rel, store.state.formats, { movieId: m.id });
      file.customFormatScore = scoreOf(store, file.customFormats);
      return file;
    });
}

function scoreOf(store, matched) {
  const profile = store.state.profiles.find((p) => p.id === 1);
  const scores = new Map((profile?.formatItems ?? []).map((f) => [f.format, f.score]));
  return matched.reduce((s, f) => s + (scores.get(f.id) ?? 0), 0);
}
