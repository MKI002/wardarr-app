import { describe, expect, it } from 'vitest';
import {
  brakesFor,
  buildPlan,
  diffGuides,
  executeSyncPlan,
  filterPlan,
  mergeApplied,
  parseGuide,
  releaseScore,
  resolveTemplate,
  restoreBackup,
  suggestedTemplateProfile,
  type AppliedState,
  type ManagedIds,
  type TemplateConfig,
  type TrashGuide,
} from '../src/index.js';
import { createFakeArr, exampleFiles, exampleGuide, type FakeArr } from './trash-fakes.js';

const byName = (g: TrashGuide, name: string) => Object.values(g.profiles).find((p) => p.name === name)!;
const cfId = (g: TrashGuide, name: string) =>
  Object.values(g.customFormats).find((c) => c.name === name)!.trashId;

function hdTemplate(g: TrashGuide, extra: Partial<TemplateConfig> = {}): TemplateConfig {
  const p = byName(g, 'Example HD Bluray + WEB');
  return {
    profiles: [suggestedTemplateProfile(g, p.trashId)],
    qualitySize: p.qualitySize ?? null,
    naming: { folder: 'jellyfin-tmdb', file: 'jellyfin-tmdb' },
    rename: true,
    ...extra,
  };
}

async function snapshot(arr: FakeArr) {
  return {
    customFormats: await arr.customFormats(),
    qualityProfiles: await arr.qualityProfiles(),
    qualityDefinitions: await arr.qualityDefinitions(),
    naming: await arr.naming(),
    languages: await arr.languages(),
  };
}

/** Plans, applies everything and returns the new managed ids and applied state. */
async function syncAll(
  arr: FakeArr,
  g: TrashGuide,
  config: TemplateConfig,
  managed: ManagedIds = {},
  applied: AppliedState | null = null,
) {
  const desired = resolveTemplate(g, config);
  const plan = buildPlan(desired, await snapshot(arr), managed, applied);
  const result = await executeSyncPlan(arr, plan, managed);
  expect(result.error).toBeNull();
  return { plan, result, managed: result.managed, applied: mergeApplied(applied, desired, plan, plan) };
}

describe('TRaSH guide parser', () => {
  it('reads profiles, formats, groups, sizes, naming and conflicts', () => {
    const g = exampleGuide('radarr');
    expect(Object.keys(g.customFormats)).toHaveLength(11);
    expect(byName(g, '[German] Example HD Bluray + WEB')).toMatchObject({
      category: 'German',
      scoreSet: 'german',
      language: 'Any',
    });
    expect(byName(g, 'Example HD Bluray + WEB').category).toBe('Standard');
    expect(g.naming.folder?.['jellyfin-tmdb']).toContain('tmdbid');
    expect(g.conflicts).toHaveLength(1);
    const unwanted = Object.values(g.cfGroups).find((x) => x.name === '[Unwanted] Unwanted Formats')!;
    expect(unwanted.recommended).toBe(true);
    expect(unwanted.formats.find((f) => f.name === 'x265 (HD)')).toMatchObject({
      required: false,
      preselected: true,
    });
  });

  it('skips files it does not understand and keeps the rest', () => {
    const g = exampleGuide('radarr');
    expect(g.skipped).toEqual([expect.objectContaining({ path: 'cf/example-broken.json' })]);
  });

  it('flattens nested Sonarr naming', () => {
    const g = exampleGuide('sonarr');
    expect(Object.keys(g.naming).sort()).toEqual([
      'episodes.anime',
      'episodes.daily',
      'episodes.standard',
      'season',
      'series',
    ]);
  });

  it('lists what changed between two guide versions', () => {
    const files = exampleFiles('radarr');
    const before = parseGuide('radarr', files);
    const changed = structuredClone(files) as Record<string, { trash_scores?: Record<string, number> }>;
    changed['cf/example-tier-02.json']!.trash_scores!.default = 1700;
    delete changed['cf/example-hfr.json'];
    const after = parseGuide('radarr', changed);
    const log = diffGuides(before, after);
    expect(log).toContainEqual(
      expect.objectContaining({ name: 'Example Tier 02', change: 'changed', parts: ['scores.default'] }),
    );
    expect(log).toContainEqual(expect.objectContaining({ name: 'HFR', change: 'removed' }));
  });
});

describe('template resolution', () => {
  const g = exampleGuide('radarr');

  it('adds the profile formats and the recommended groups with guide scores', () => {
    const desired = resolveTemplate(g, hdTemplate(g));
    const formats = desired.objects.filter((o) => o.kind === 'customFormat').map((o) => o.label);
    expect(formats.sort()).toEqual([
      'BR-DISK',
      'Example Tier 01',
      'Example Tier 02',
      'LQ',
      'Repack/Proper',
      'x265 (HD)',
    ]);
    const profile = desired.objects.find((o) => o.kind === 'qualityProfile')!;
    expect(profile.fields[`score:${cfId(g, 'Example Tier 01')}`]).toBe(1800);
    expect(profile.fields[`score:${cfId(g, 'BR-DISK')}`]).toBe(-10000);
    expect(profile.fields.language).toBe('Original');
    expect(desired.objects.find((o) => o.kind === 'naming')!.fields).toMatchObject({ renameMovies: true });
    expect(desired.warnings).toEqual([]);
  });

  it('uses the score set of the profile and keeps own scores', () => {
    const p = byName(g, '[German] Example HD Bluray + WEB');
    const tp = {
      ...suggestedTemplateProfile(g, p.trashId),
      scoreOverrides: { [cfId(g, 'Example Tier 01')]: 42 },
    };
    const desired = resolveTemplate(g, { profiles: [tp], qualitySize: null, naming: {}, rename: false });
    const fields = desired.objects.find((o) => o.kind === 'qualityProfile')!.fields;
    expect(fields[`score:${cfId(g, 'German DL')}`]).toBe(10000);
    expect(fields[`score:${cfId(g, 'x265 (HD)')}`]).toBe(0);
    expect(fields[`score:${cfId(g, 'Example Tier 01')}`]).toBe(42);
  });

  it('warns about conflicting formats', () => {
    const tp = {
      ...suggestedTemplateProfile(g, byName(g, 'Example HD Bluray + WEB').trashId),
      extraFormats: [cfId(g, 'x265 (no HDR/DV)')],
    };
    const desired = resolveTemplate(g, { profiles: [tp], qualitySize: null, naming: {}, rename: false });
    expect(desired.warnings).toContainEqual(expect.objectContaining({ code: 'conflict' }));
  });

  it('lets optional formats of a group be switched off', () => {
    const tp = {
      ...suggestedTemplateProfile(g, byName(g, 'Example HD Bluray + WEB').trashId),
      excludedFormats: [cfId(g, 'x265 (HD)')],
    };
    const desired = resolveTemplate(g, { profiles: [tp], qualitySize: null, naming: {}, rename: false });
    expect(desired.objects.some((o) => o.label === 'x265 (HD)')).toBe(false);
    expect(desired.objects.some((o) => o.label === 'BR-DISK')).toBe(true);
  });
});

describe('sync against an instance', () => {
  it('creates everything on an empty instance, then finds nothing to do', async () => {
    const g = exampleGuide('radarr');
    const arr = createFakeArr();
    const { plan, managed, applied } = await syncAll(arr, g, hdTemplate(g));
    expect(plan.counts.create).toBe(7);
    expect(arr.state.formats).toHaveLength(6);
    const profile = arr.state.profiles[0]!;
    expect(profile.name).toBe('Example HD Bluray + WEB');
    // Items are stored lowest first; the cutoff points at Bluray-1080p.
    const top = profile.items[profile.items.length - 1]!;
    expect(top.quality?.name).toBe('Bluray-1080p');
    expect(profile.cutoff).toBe(top.quality!.id);
    const web = profile.items.find((i) => i.name === 'WEB 1080p')!;
    expect(web.items.map((i) => i.quality!.name).sort()).toEqual(['WEBDL-1080p', 'WEBRip-1080p']);
    expect(profile.language).toEqual({ id: -2, name: 'Original' });
    const tier1 = arr.state.formats.find((f) => f.name === 'Example Tier 01')!;
    expect(profile.formatItems.find((f) => f.format === tier1.id)!.score).toBe(1800);
    expect(arr.state.naming.renameMovies).toBe(true);
    expect(arr.state.definitions.find((d) => d.quality.name === 'WEBDL-1080p')!.maxSize).toBe(1000);

    const again = buildPlan(resolveTemplate(g, hdTemplate(g)), await snapshot(arr), managed, applied);
    expect(again.counts).toMatchObject({ create: 0, update: 0, fields: 0 });
  });

  it('adopts existing formats and profiles by name instead of duplicating them', async () => {
    const g = exampleGuide('radarr');
    const arr = createFakeArr();
    await arr.createCustomFormat({ name: 'lq', includeCustomFormatWhenRenaming: false, specifications: [] });
    const plan = buildPlan(resolveTemplate(g, hdTemplate(g)), await snapshot(arr), {}, null);
    const lq = plan.objects.find((o) => o.label === 'LQ')!;
    expect(lq).toMatchObject({ action: 'update', adopted: true });
    expect(lq.changes.map((c) => c.field)).toEqual(['name', 'specifications']);
  });

  it('tells guide changes from changes made in the instance', async () => {
    const g = exampleGuide('radarr');
    const arr = createFakeArr();
    const first = await syncAll(arr, g, hdTemplate(g));
    // Someone changes a score by hand ...
    const tier1 = arr.state.formats.find((f) => f.name === 'Example Tier 01')!;
    arr.state.profiles[0]!.formatItems.find((f) => f.format === tier1.id)!.score = 1;
    // ... and the guide changes another one.
    const files = structuredClone(exampleFiles('radarr')) as Record<
      string,
      { trash_scores?: Record<string, number> }
    >;
    files['cf/example-tier-02.json']!.trash_scores!.default = 1700;
    const g2 = parseGuide('radarr', files);
    const desired = resolveTemplate(g2, hdTemplate(g2));
    const plan = buildPlan(desired, await snapshot(arr), first.managed, first.applied);
    const changes = plan.objects.find((o) => o.kind === 'qualityProfile')!.changes;
    expect(changes).toEqual([
      expect.objectContaining({
        field: `score:${cfId(g, 'Example Tier 01')}`,
        before: 1,
        after: 1800,
        origin: 'local',
      }),
      expect.objectContaining({
        field: `score:${cfId(g, 'Example Tier 02')}`,
        before: 1750,
        after: 1700,
        origin: 'guide',
      }),
    ]);

    // Auto mode applies only the guide change; the local change stays local.
    const auto = filterPlan(plan, ['guide']);
    expect(auto.counts.fields).toBe(1);
    const res = await executeSyncPlan(arr, auto, first.managed);
    expect(res.error).toBeNull();
    const applied = mergeApplied(first.applied, desired, plan, auto);
    const next = buildPlan(desired, await snapshot(arr), res.managed, applied);
    expect(next.objects.find((o) => o.kind === 'qualityProfile')!.changes).toEqual([
      expect.objectContaining({ field: `score:${cfId(g, 'Example Tier 01')}`, origin: 'local' }),
    ]);
  });

  it('applies the brakes for cutoff, quality and many changes', async () => {
    const g = exampleGuide('radarr');
    const arr = createFakeArr();
    const first = await syncAll(arr, g, hdTemplate(g));
    const files = structuredClone(exampleFiles('radarr')) as Record<string, { cutoff?: string }>;
    const key = Object.keys(files).find((k) => k.endsWith('quality-profiles/hd.json'))!;
    files[key]!.cutoff = 'Bluray-720p';
    const g2 = parseGuide('radarr', files);
    const plan = buildPlan(
      resolveTemplate(g2, hdTemplate(g2)),
      await snapshot(arr),
      first.managed,
      first.applied,
    );
    expect(brakesFor(plan, 25)).toEqual(['cutoff']);
    expect(brakesFor(plan, 0)).toContain('manyChanges');
  });

  it('plans removal of managed formats only when asked', async () => {
    const g = exampleGuide('radarr');
    const arr = createFakeArr();
    const first = await syncAll(arr, g, hdTemplate(g));
    const tp = { ...hdTemplate(g).profiles[0]!, excludedFormats: [cfId(g, 'x265 (HD)')] };
    const plan = buildPlan(
      resolveTemplate(g, hdTemplate(g, { profiles: [tp] })),
      await snapshot(arr),
      first.managed,
      first.applied,
    );
    expect(plan.objects.find((o) => o.action === 'remove')?.label).toBe('x265 (HD)');
    expect(filterPlan(plan, ['guide', 'local']).counts.remove).toBe(0);
    const res = await executeSyncPlan(arr, filterPlan(plan, ['guide'], true), first.managed, {
      removals: true,
    });
    expect(res.error).toBeNull();
    expect(arr.state.formats.some((f) => f.name === 'x265 (HD)')).toBe(false);
  });

  it('rolls a sync back to the state before it', async () => {
    const g = exampleGuide('radarr');
    const arr = createFakeArr();
    // An instance with an own profile and naming before the first sync.
    const own = await arr.createCustomFormat({
      name: 'Own Format',
      includeCustomFormatWhenRenaming: false,
      specifications: [],
    });
    const schema = await arr.qualityProfileSchema();
    await arr.createQualityProfile({
      ...schema,
      name: 'Own Profile',
      cutoff: schema.items[0]!.quality!.id,
      formatItems: [{ format: own.id, score: 7 }],
    });
    const before = structuredClone(arr.state);
    const { result } = await syncAll(arr, g, hdTemplate(g));
    expect(arr.state.formats.length).toBeGreaterThan(1);
    const restored = await restoreBackup(arr, result.backup);
    expect(restored.errors).toEqual([]);
    expect(arr.state.formats.map((f) => f.name)).toEqual(['Own Format']);
    expect(arr.state.profiles.map((p) => p.name)).toEqual(['Own Profile']);
    expect(arr.state.profiles[0]!.formatItems).toEqual([
      expect.objectContaining({ format: own.id, score: 7 }),
    ]);
    expect(arr.state.naming).toEqual(before.naming);
    expect(arr.state.definitions).toEqual(before.definitions);
  });

  it('stops at the first error and keeps the backup of what ran', async () => {
    const g = exampleGuide('radarr');
    const arr = createFakeArr();
    arr.state.failOn = 'createQualityProfile';
    const plan = buildPlan(resolveTemplate(g, hdTemplate(g)), await snapshot(arr), {}, null);
    const res = await executeSyncPlan(arr, plan, {});
    expect(res.error?.key).toMatch(/^qp:/);
    expect(res.backup.created.customFormats).toHaveLength(6);
    expect(arr.state.calls).not.toContain('updateNaming');
    arr.state.failOn = undefined;
    await restoreBackup(arr, res.backup);
    expect(arr.state.formats).toEqual([]);
  });
});

describe('release test', () => {
  it('adds up the scores of the matching formats', async () => {
    const g = exampleGuide('radarr');
    const arr = createFakeArr();
    await syncAll(arr, g, hdTemplate(g));
    const parsed = await arr.parseRelease('Example.Film.2021.1080p.BluRay.x265-HARBOR');
    const score = releaseScore(parsed, arr.state.profiles[0]!);
    expect(score.formats.map((f) => f.name)).toContain('x265 (HD)');
    expect(score.total).toBe(-10000);
    expect(score.accepted).toBe(false);
  });
});
