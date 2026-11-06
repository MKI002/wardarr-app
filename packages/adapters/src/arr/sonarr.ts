import { defineAdapter } from '@wardarr/core';
import { apiKeyField, apiKeySchema } from '../shared/fields.js';
import { createArrInstance, type ArrProfile } from './base.js';

/**
 * Sonarr v3 and v4 speak API v3. Sonarr v5 adds API v5 for metadata
 * languages and series orders; Wardarr keeps using v3 there as long as it is
 * offered and reports the instance in compatibility mode.
 */
export const SONARR_PROFILE: ArrProfile = {
  product: 'Sonarr',
  apis: ['v3'],
  testedMajors: { min: 3, max: 4 },
  flavor: () => ({
    includeUnknownParam: 'includeUnknownSeriesItems',
    mediaIdField: 'seriesId',
    mediaKind: 'episode',
    family: 'series',
  }),
};

export const sonarr = defineAdapter({
  id: 'sonarr',
  name: 'Sonarr',
  category: 'arr',
  lifecycle: 'active',
  homepage: 'https://sonarr.tv',
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
    'trashSync',
  ],
  mediaKind: 'episode',
  create: (ctx) => createArrInstance(ctx, 'sonarr', SONARR_PROFILE, { profileSyncSince: 4 }),
});
