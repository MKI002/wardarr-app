import { defineAdapter } from '@wardarr/core';
import { apiKeyField, apiKeySchema } from '../shared/fields.js';
import { createArrInstance, type ArrFlavor } from './base.js';

export const RADARR_FLAVOR: ArrFlavor = {
  apiBase: '/api/v3',
  includeUnknownParam: 'includeUnknownMovieItems',
  mediaIdField: 'movieId',
  mediaKind: 'movie',
  family: 'movie',
};

export const radarr = defineAdapter({
  id: 'radarr',
  name: 'Radarr',
  category: 'arr',
  lifecycle: 'active',
  homepage: 'https://radarr.video',
  fields: [apiKeyField],
  credentials: apiKeySchema,
  capabilities: ['health', 'queue', 'queueActions', 'manualImport', 'wanted', 'search', 'history', 'settings'],
  mediaKind: 'movie',
  create: (ctx) => createArrInstance(ctx, 'radarr', () => RADARR_FLAVOR),
});
