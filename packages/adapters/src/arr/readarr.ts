// Readarr is no longer developed upstream. The adapter keeps working for
// existing installations and is marked as discontinued in the UI.
import { defineAdapter } from '@wardarr/core';
import { apiKeyField, apiKeySchema } from '../shared/fields.js';
import { createArrInstance, type ArrProfile } from './base.js';

/** Readarr 0.x speaks API v1. */
export const READARR_PROFILE: ArrProfile = {
  product: 'Readarr',
  apis: ['v1'],
  testedMajors: { min: 0, max: 0 },
  flavor: () => ({
    includeUnknownParam: 'includeUnknownAuthorItems',
    mediaIdField: 'bookId',
    mediaKind: 'book',
    family: 'book',
  }),
};

export const readarr = defineAdapter({
  id: 'readarr',
  name: 'Readarr',
  category: 'arr',
  lifecycle: 'upstreamDiscontinued',
  homepage: 'https://github.com/Readarr/Readarr',
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
  ],
  mediaKind: 'book',
  create: (ctx) => createArrInstance(ctx, 'readarr', READARR_PROFILE),
});
