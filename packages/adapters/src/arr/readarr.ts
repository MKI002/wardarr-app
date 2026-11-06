// Readarr is no longer developed upstream. The adapter keeps working for
// existing installations and is marked as discontinued in the UI.
import { defineAdapter } from '@wardarr/core';
import { apiKeyField, apiKeySchema } from '../shared/fields.js';
import { createArrInstance, type ArrFlavor } from './base.js';

export const READARR_FLAVOR: ArrFlavor = {
  apiBase: '/api/v1',
  includeUnknownParam: 'includeUnknownAuthorItems',
  mediaIdField: 'bookId',
  mediaKind: 'book',
};

export const readarr = defineAdapter({
  id: 'readarr',
  name: 'Readarr',
  category: 'arr',
  lifecycle: 'upstreamDiscontinued',
  homepage: 'https://github.com/Readarr/Readarr',
  fields: [apiKeyField],
  credentials: apiKeySchema,
  capabilities: ['health', 'queue', 'settings'],
  mediaKind: 'book',
  create: (ctx) => createArrInstance(ctx, 'readarr', () => READARR_FLAVOR),
});
