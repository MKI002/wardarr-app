import { describe, expect, it } from 'vitest';
import {
  audioGroup,
  bestCompatible,
  buildQualityReport,
  categorizeFormat,
  hdrGroup,
  languageCodes,
  videoGroup,
  type QualityScan,
  type QualityScanFile,
} from '../src/index.js';

describe('categorizeFormat', () => {
  it('follows a prefix before the colon', () => {
    expect(categorizeFormat('Audio: Atmos / DTS:X', [], 500)).toBe('audio');
    expect(categorizeFormat('Codec: AV1', [], 100)).toBe('video');
    expect(categorizeFormat('HDR: Dolby Vision', [], 100)).toBe('hdr');
    expect(categorizeFormat('Language: German', ['LanguageSpecification'], 100)).toBe('language');
    expect(categorizeFormat('Source: WEB-DL', [], 100)).toBe('source');
    expect(categorizeFormat('Reject: 3D', [], -10000)).toBe('unwanted');
    // A "Quality:" prefix says nothing about the kind, so the name decides.
    expect(categorizeFormat('Quality: 10-bit', [], 50)).toBe('video');
    expect(categorizeFormat('Quality: Repack / Proper', [], 5)).toBe('fix');
  });

  it('reads TRaSH-style names', () => {
    expect(categorizeFormat('TrueHD ATMOS', ['ReleaseTitleSpecification'], 5000)).toBe('audio');
    expect(categorizeFormat('DD+', [], 100)).toBe('audio');
    expect(categorizeFormat('DV HDR10Plus', [], 1500)).toBe('hdr');
    expect(categorizeFormat('German DL', ['LanguageSpecification', 'LanguageSpecification'], 10000)).toBe(
      'language',
    );
    expect(categorizeFormat('Remux Tier 01', ['ReleaseGroupSpecification'], 1950)).toBe('group');
    expect(categorizeFormat('AMZN', ['ReleaseTitleSpecification'], 10)).toBe('source');
    expect(categorizeFormat('x265 (HD)', [], -10000)).toBe('unwanted');
    expect(categorizeFormat('Repack/Proper', [], 5)).toBe('fix');
    expect(categorizeFormat('HFR', [], 10)).toBe('other');
  });
});

describe('media groups', () => {
  it('folds codec spellings', () => {
    expect(videoGroup('x265')).toBe('HEVC');
    expect(videoGroup('h264')).toBe('AVC');
    expect(hdrGroup('DV HDR10Plus')).toBe('Dolby Vision');
    expect(hdrGroup('HDR10Plus')).toBe('HDR10+');
    expect(hdrGroup('')).toBe('SDR');
    expect(audioGroup('EAC3 Atmos')).toBe('DD+ Atmos');
    expect(audioGroup('DTS-HD MA')).toBe('DTS-HD MA');
    expect(audioGroup('AC3')).toBe('DD');
  });

  it('turns ISO 639-2 codes into ISO 639-1', () => {
    expect(languageCodes('eng/ger/jpn')).toEqual(['en', 'de', 'ja']);
    expect(languageCodes(['deu', 'und', 'Klingon'])).toEqual(['de', 'und']);
  });
});

describe('bestCompatible', () => {
  it('only combines formats seen together', () => {
    const seen = new Set(['1:2']);
    const together = (a: number, b: number) => seen.has(a < b ? `${a}:${b}` : `${b}:${a}`);
    const items = [
      { id: 1, score: 500 },
      { id: 2, score: 500 },
      { id: 3, score: 900 },
    ];
    expect(
      bestCompatible(items, together)
        .map((c) => c.id)
        .sort(),
    ).toEqual([1, 2]);
    expect(bestCompatible([{ id: 3, score: 1500 }, ...items.slice(0, 2)], together).map((c) => c.id)).toEqual(
      [3],
    );
  });
});

const media = {
  videoCodec: 'x265',
  dynamicRange: '',
  audioCodec: 'EAC3',
  audioChannels: 6,
  audioLanguages: ['ger', 'eng'],
  subtitles: ['ger'],
};

const file = (id: number, titleId: number, formatIds: number[]): QualityScanFile => ({
  id,
  titleId,
  formatIds,
  reportedScore: null,
  quality: 'WEBDL-1080p',
  resolution: 1080,
  sizeBytes: 1000,
  media,
});

function scan(): QualityScan {
  return {
    formats: [
      { id: 1, name: 'Language: German', specs: ['LanguageSpecification'] },
      { id: 2, name: 'Language: English', specs: ['LanguageSpecification'] },
      { id: 3, name: 'Codec: HEVC', specs: [] },
      { id: 4, name: 'Codec: AV1', specs: [] },
      { id: 5, name: 'HDR: Dolby Vision', specs: [] },
      { id: 6, name: 'Reject: LQ Groups', specs: [] },
      { id: 7, name: 'Quality: Repack / Proper', specs: [] },
    ],
    profiles: [
      {
        id: 1,
        name: 'HD',
        upgradeAllowed: true,
        cutoffFormatScore: 1000,
        minFormatScore: 0,
        scores: [
          { format: 1, score: 1000 },
          { format: 2, score: 200 },
          { format: 3, score: 100 },
          { format: 4, score: 150 },
          { format: 5, score: 300 },
          { format: 6, score: -10000 },
          { format: 7, score: 5 },
        ],
      },
      { id: 2, name: 'Any', upgradeAllowed: false, cutoffFormatScore: 0, minFormatScore: 0, scores: [] },
    ],
    titles: [
      { id: 10, title: 'Lanternfall', year: 2024, profileId: 1, webUrl: null },
      { id: 11, title: 'Kestrel Station', year: 2025, profileId: 1, webUrl: null },
      { id: 12, title: 'Unscored', year: null, profileId: 2, webUrl: null },
    ],
    files: [
      // German + English together: both count in the perfect file.
      file(1, 10, [1, 2, 4, 5]),
      file(2, 10, [1, 3]),
      file(3, 11, [2, 6]),
      file(4, 11, [1, 2, 4, 5, 7]),
      file(5, 12, []),
    ],
  };
}

describe('buildQualityReport', () => {
  const report = buildQualityReport(scan());

  it('builds the perfect file from the best of each kind', () => {
    const hd = report.profiles.find((p) => p.name === 'HD')!;
    // German 1000 + English 200 + AV1 150 (not with HEVC) + DV 300; repack is a bonus.
    expect(hd.perfect).toBe(1650);
    expect(hd.recipe.map((r) => r.name)).toEqual([
      'Language: German',
      'HDR: Dolby Vision',
      'Language: English',
      'Codec: AV1',
    ]);
    expect(hd.target).toBe(1000);
  });

  it('measures every file against its profile', () => {
    expect(report.files).toBe(4);
    expect(report.unscored).toBe(1);
    expect(report.tiers).toEqual({ perfect: 2, target: 1, upgrading: 0, penalised: 1 });
    expect(report.histogram[10]).toBe(2);
    expect(report.histogram[0]).toBe(1);
    // File 2: 1100 of 1650.
    expect(report.histogram[6]).toBe(1);
    expect(report.gapSum).toBe(0 + 550 + (1650 - (200 - 10000)) + 0);
  });

  it('says where the points go', () => {
    const language = report.categories.find((c) => c.category === 'language')!;
    expect(language).toEqual({ category: 'language', files: 2, points: 200 + 1000 });
    const unwanted = report.categories.find((c) => c.category === 'unwanted')!;
    expect(unwanted.points).toBe(10000);
    const lq = report.formats.find((f) => f.penalty)!;
    expect(lq).toMatchObject({ name: 'Reject: LQ Groups', files: 1, points: 10000 });
  });

  it('lists the titles furthest from perfect first', () => {
    expect(report.titles.map((t) => t.title)).toEqual(['Kestrel Station', 'Lanternfall']);
    expect(report.titles[0]!.penalties).toEqual([{ name: 'Reject: LQ Groups', files: 1 }]);
    expect(report.titles[1]!.missing.map((m) => m.name)).toContain('HDR: Dolby Vision');
  });

  it('counts what the files contain, scored or not', () => {
    expect(report.contents.video).toEqual({ HEVC: 5 });
    expect(report.contents.audioLanguages).toEqual({ de: 5, en: 5 });
    expect(report.contents.resolution).toEqual({ '1080p': 5 });
  });
});
