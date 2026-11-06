import { defineAdapter } from '@wardarr/core';
import { apiKeyField, apiKeySchema } from '../shared/fields.js';
import { createArrInstance, type ArrFlavor } from './base.js';

export const SONARR_FLAVOR: ArrFlavor = {
  apiBase: '/api/v3',
  includeUnknownParam: 'includeUnknownSeriesItems',
  mediaIdField: 'seriesId',
  mediaKind: 'episode',
};

export const sonarr = defineAdapter({
  id: 'sonarr',
  name: 'Sonarr',
  category: 'arr',
  lifecycle: 'active',
  homepage: 'https://sonarr.tv',
  fields: [apiKeyField],
  credentials: apiKeySchema,
  capabilities: ['health', 'queue', 'settings'],
  mediaKind: 'episode',
  create: (ctx) => createArrInstance(ctx, 'sonarr', () => SONARR_FLAVOR),
});
