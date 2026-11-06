// Whisparr v2 is based on Sonarr, v3 ("Eros") on Radarr. The flavor is
// chosen from the reported version, so one adapter serves both.
import { defineAdapter, type AdapterContext } from '@wardarr/core';
import { apiKeyField, apiKeySchema } from '../shared/fields.js';
import { jsonOf } from '../shared/http.js';
import { createArrInstance, type ArrFlavor } from './base.js';

export const WHISPARR_V2_FLAVOR: ArrFlavor = {
  apiBase: '/api/v3',
  includeUnknownParam: 'includeUnknownSeriesItems',
  mediaIdField: 'seriesId',
  mediaKind: 'scene',
};

export const WHISPARR_V3_FLAVOR: ArrFlavor = {
  apiBase: '/api/v3',
  includeUnknownParam: 'includeUnknownMovieItems',
  mediaIdField: 'movieId',
  mediaKind: 'scene',
};

export function whisparrFlavor(version: string | undefined): ArrFlavor {
  const major = Number((version ?? '').split('.')[0]);
  return major >= 3 ? WHISPARR_V3_FLAVOR : WHISPARR_V2_FLAVOR;
}

async function detect(ctx: AdapterContext<{ apiKey: string }>): Promise<ArrFlavor> {
  const status = jsonOf<{ version?: string }>(
    await ctx.http.request({
      path: '/api/v3/system/status',
      headers: { 'X-Api-Key': ctx.credentials.apiKey },
    }),
  );
  return whisparrFlavor(status.version);
}

export const whisparr = defineAdapter({
  id: 'whisparr',
  name: 'Whisparr',
  category: 'arr',
  lifecycle: 'active',
  homepage: 'https://github.com/Whisparr/Whisparr',
  fields: [apiKeyField],
  credentials: apiKeySchema,
  capabilities: ['health', 'queue', 'settings'],
  mediaKind: 'scene',
  create(ctx) {
    const inst = createArrInstance(ctx, 'whisparr', () => detect(ctx));
    return {
      ...inst,
      async testConnection() {
        const info = await inst.testConnection();
        return {
          ...info,
          variant: whisparrFlavor(info.version ?? undefined) === WHISPARR_V3_FLAVOR ? 'v3' : 'v2',
        };
      },
    };
  },
});
