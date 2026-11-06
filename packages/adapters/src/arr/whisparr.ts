// Whisparr v2 is based on Sonarr, v3 ("Eros") on Radarr. The flavor is
// chosen from the detected version, so one adapter serves both and follows
// an upgrade from v2 to v3 by itself.
import { defineAdapter } from '@wardarr/core';
import { majorOf } from '../shared/apiVersion.js';
import { apiKeyField, apiKeySchema } from '../shared/fields.js';
import { createArrInstance, type ArrFlavor, type ArrProfile } from './base.js';

type Flavor = Omit<ArrFlavor, 'apiBase'>;

export const WHISPARR_V2_FLAVOR: Flavor = {
  includeUnknownParam: 'includeUnknownSeriesItems',
  mediaIdField: 'seriesId',
  mediaKind: 'scene',
  family: 'series',
};

export const WHISPARR_V3_FLAVOR: Flavor = {
  includeUnknownParam: 'includeUnknownMovieItems',
  mediaIdField: 'movieId',
  mediaKind: 'scene',
  family: 'movie',
};

export function whisparrFlavor(version: string | null | undefined): Flavor {
  return majorOf(version) >= 3 ? WHISPARR_V3_FLAVOR : WHISPARR_V2_FLAVOR;
}

export const WHISPARR_PROFILE: ArrProfile = {
  product: 'Whisparr',
  apis: ['v3'],
  testedMajors: { min: 2, max: 3 },
  flavor: (d) => whisparrFlavor(d.productVersion),
};

export const whisparr = defineAdapter({
  id: 'whisparr',
  name: 'Whisparr',
  category: 'arr',
  lifecycle: 'active',
  homepage: 'https://github.com/Whisparr/Whisparr',
  fields: [apiKeyField],
  credentials: apiKeySchema,
  capabilities: [
    'health',
    'queue',
    'queueActions',
    'manualImport',
    'wanted',
    'search',
    'history',
    'settings',
  ],
  mediaKind: 'scene',
  create(ctx) {
    const inst = createArrInstance(ctx, 'whisparr', WHISPARR_PROFILE);
    return {
      ...inst,
      async testConnection() {
        const info = await inst.testConnection();
        return { ...info, variant: whisparrFlavor(info.version) === WHISPARR_V3_FLAVOR ? 'v3' : 'v2' };
      },
    };
  },
});
