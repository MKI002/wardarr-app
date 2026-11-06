// Test helpers for the TRaSH Guides sync: the invented guide from
// testbed/trash-guides and an in-memory Sonarr/Radarr that validates like
// the real API (every profile lists every custom format, cutoffs must exist).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AdapterError,
  parseGuide,
  type ArrCustomFormat,
  type ArrNaming,
  type ArrQualityDefinition,
  type ArrQualityProfile,
  type ProfileSyncApi,
  type TrashGuide,
  type TrashProduct,
} from '../src/index.js';

export const GUIDE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../testbed/trash-guides',
);

function walk(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, r));
    else if (name.endsWith('.json')) out.push(r);
  }
  return out;
}

/** Files of one product, keyed as parseGuide expects. */
export function exampleFiles(product: TrashProduct): Record<string, unknown> {
  const base = path.join(GUIDE_DIR, 'docs/json', product);
  return Object.fromEntries(walk(base).map((f) => [f, JSON.parse(readFileSync(path.join(base, f), 'utf8'))]));
}

export function exampleGuide(product: TrashProduct = 'radarr'): TrashGuide {
  return parseGuide(product, exampleFiles(product));
}

const RADARR_QUALITIES = [
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
];

export interface FakeArr extends ProfileSyncApi {
  state: {
    formats: ArrCustomFormat[];
    profiles: ArrQualityProfile[];
    definitions: ArrQualityDefinition[];
    naming: ArrNaming;
    calls: string[];
    failOn?: string;
    unsupported?: boolean;
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function createFakeArr(): FakeArr {
  let nextId = 100;
  const definitions: ArrQualityDefinition[] = RADARR_QUALITIES.map((name, i) => ({
    id: i + 1,
    quality: { id: i, name, source: 'example', resolution: 0 },
    title: name,
    minSize: 0,
    maxSize: 400,
    preferredSize: 300,
  }));
  const state: FakeArr['state'] = {
    formats: [],
    profiles: [],
    definitions,
    naming: {
      id: 1,
      renameMovies: false,
      movieFolderFormat: '{Movie Title} ({Release Year})',
      standardMovieFormat: '{Movie Title}',
    },
    calls: [],
  };
  const call = (name: string) => {
    if (state.unsupported) throw new AdapterError('unsupported', 'no custom formats');
    state.calls.push(name);
    if (state.failOn && name.startsWith(state.failOn))
      throw new AdapterError('badResponse', `HTTP 500 on ${name}`, 500);
  };
  const validateProfile = (p: ArrQualityProfile) => {
    const ids = new Set(p.formatItems.map((f) => f.format));
    if (ids.size !== state.formats.length || state.formats.some((f) => !ids.has(f.id)))
      throw new AdapterError('badResponse', 'All Custom Formats and no extra ones need to be present', 400);
    const cutoffs = p.items.map((i) => (i.quality ? i.quality.id : i.id));
    if (!cutoffs.includes(p.cutoff))
      throw new AdapterError('badResponse', 'cutoff must be an allowed quality', 400);
  };
  const schema = (): ArrQualityProfile => ({
    id: 0,
    name: '',
    upgradeAllowed: false,
    cutoff: 0,
    items: definitions.map((d) => ({ quality: clone(d.quality), items: [], allowed: false })),
    minFormatScore: 0,
    cutoffFormatScore: 0,
    minUpgradeFormatScore: 1,
    formatItems: state.formats.map((f) => ({ format: f.id, name: f.name, score: 0 })),
    language: { id: 1, name: 'English' },
  });

  return {
    state,
    async ensureSupported() {
      if (state.unsupported) throw new AdapterError('unsupported', 'no custom formats');
    },
    async customFormats() {
      call('customFormats');
      return clone(state.formats);
    },
    async createCustomFormat(cf) {
      call('createCustomFormat');
      if (state.formats.some((f) => f.name.toLowerCase() === cf.name.toLowerCase()))
        throw new AdapterError('badResponse', 'name must be unique', 400);
      const created = { ...clone(cf), id: nextId++ } as ArrCustomFormat;
      state.formats.push(created);
      for (const p of state.profiles)
        p.formatItems.push({ format: created.id, name: created.name, score: 0 });
      return clone(created);
    },
    async updateCustomFormat(cf) {
      call('updateCustomFormat');
      const i = state.formats.findIndex((f) => f.id === cf.id);
      if (i < 0) throw new AdapterError('notFound', 'HTTP 404', 404);
      state.formats[i] = clone(cf);
      return clone(cf);
    },
    async deleteCustomFormat(id) {
      call('deleteCustomFormat');
      state.formats = state.formats.filter((f) => f.id !== id);
      for (const p of state.profiles) p.formatItems = p.formatItems.filter((f) => f.format !== id);
    },
    async qualityProfiles() {
      call('qualityProfiles');
      return clone(state.profiles);
    },
    async qualityProfileSchema() {
      call('qualityProfileSchema');
      return schema();
    },
    async createQualityProfile(p) {
      call('createQualityProfile');
      const created = { ...clone(p), id: nextId++ } as ArrQualityProfile;
      validateProfile(created);
      state.profiles.push(created);
      return clone(created);
    },
    async updateQualityProfile(p) {
      call('updateQualityProfile');
      validateProfile(p);
      const i = state.profiles.findIndex((x) => x.id === p.id);
      if (i < 0) throw new AdapterError('notFound', 'HTTP 404', 404);
      state.profiles[i] = clone(p);
      return clone(p);
    },
    async deleteQualityProfile(id) {
      call('deleteQualityProfile');
      state.profiles = state.profiles.filter((p) => p.id !== id);
    },
    async qualityDefinitions() {
      call('qualityDefinitions');
      return clone(state.definitions);
    },
    async updateQualityDefinitions(defs) {
      call('updateQualityDefinitions');
      for (const d of defs) {
        const i = state.definitions.findIndex((x) => x.id === d.id);
        if (i >= 0) state.definitions[i] = clone(d);
      }
    },
    async naming() {
      call('naming');
      return clone(state.naming);
    },
    async updateNaming(n) {
      call('updateNaming');
      state.naming = clone(n);
    },
    async languages() {
      return [
        { id: -2, name: 'Original' },
        { id: -1, name: 'Any' },
        { id: 1, name: 'English' },
        { id: 4, name: 'German' },
      ];
    },
    async parseRelease(title) {
      call('parseRelease');
      const matched = state.formats.filter((f) =>
        f.specifications.some((s) => {
          const v = s.fields.find((x) => x.name === 'value')?.value;
          if (s.implementation !== 'ReleaseTitleSpecification' || typeof v !== 'string') return false;
          try {
            return new RegExp(v, 'i').test(title) !== s.negate;
          } catch {
            return false;
          }
        }),
      );
      return {
        title,
        quality: /2160p/i.test(title) ? 'WEBDL-2160p' : 'WEBDL-1080p',
        customFormats: matched.map((f) => ({ id: f.id, name: f.name })),
        languages: ['English'],
        releaseGroup: title.split('-').pop() ?? null,
      };
    },
  };
}
