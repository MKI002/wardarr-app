import { defineAdapter } from '@wardarr/core';
import { apiKeyField, apiKeySchema } from '../shared/fields.js';
import { createArrInstance, type ArrProfile } from './base.js';

/** Radarr v3 to v6 speak API v3. */
export const RADARR_PROFILE: ArrProfile = {
  product: 'Radarr',
  apis: ['v3'],
  testedMajors: { min: 3, max: 6 },
  flavor: () => ({
    includeUnknownParam: 'includeUnknownMovieItems',
    mediaIdField: 'movieId',
    mediaKind: 'movie',
    family: 'movie',
  }),
};

export const radarr = defineAdapter({
  id: 'radarr',
  name: 'Radarr',
  category: 'arr',
  lifecycle: 'active',
  homepage: 'https://radarr.video',
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
    'calendar',
    'trashSync',
    'storage',
  ],
  mediaKind: 'movie',
  create: (ctx) => createArrInstance(ctx, 'radarr', RADARR_PROFILE, { profileSyncSince: 3 }),
});
