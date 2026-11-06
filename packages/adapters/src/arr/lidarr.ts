import { defineAdapter } from '@wardarr/core';
import { apiKeyField, apiKeySchema } from '../shared/fields.js';
import { createArrInstance, type ArrFlavor } from './base.js';

export const LIDARR_FLAVOR: ArrFlavor = {
  apiBase: '/api/v1',
  includeUnknownParam: 'includeUnknownArtistItems',
  mediaIdField: 'albumId',
  mediaKind: 'album',
};

export const lidarr = defineAdapter({
  id: 'lidarr',
  name: 'Lidarr',
  category: 'arr',
  lifecycle: 'active',
  homepage: 'https://lidarr.audio',
  fields: [apiKeyField],
  credentials: apiKeySchema,
  capabilities: ['health', 'queue', 'settings'],
  mediaKind: 'album',
  create: (ctx) => createArrInstance(ctx, 'lidarr', () => LIDARR_FLAVOR),
});
