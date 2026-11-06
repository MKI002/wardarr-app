import { defineAdapter } from '@wardarr/core';
import { apiKeyField, apiKeySchema } from '../shared/fields.js';
import { createArrInstance, type ArrProfile } from './base.js';

/** Lidarr v1 to v3 speak API v1. */
export const LIDARR_PROFILE: ArrProfile = {
  product: 'Lidarr',
  apis: ['v1'],
  testedMajors: { min: 1, max: 3 },
  flavor: () => ({
    includeUnknownParam: 'includeUnknownArtistItems',
    mediaIdField: 'albumId',
    mediaKind: 'album',
    family: 'music',
  }),
};

export const lidarr = defineAdapter({
  id: 'lidarr',
  name: 'Lidarr',
  category: 'arr',
  lifecycle: 'active',
  homepage: 'https://lidarr.audio',
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
  mediaKind: 'album',
  create: (ctx) => createArrInstance(ctx, 'lidarr', LIDARR_PROFILE),
});
