import { defineAdapter } from '@wardarr/core';
import { z } from 'zod';
import { createEmbyLike } from './embyLike.js';

export const jellyfin = defineAdapter({
  id: 'jellyfin',
  name: 'Jellyfin',
  category: 'mediaServer',
  lifecycle: 'active',
  homepage: 'https://jellyfin.org',
  fields: [
    {
      key: 'apiKey',
      kind: 'secret',
      label: 'adapters.fields.apiKey',
      help: 'adapters.help.apiKeyJellyfin',
      required: true,
    },
  ],
  credentials: z.object({ apiKey: z.string().trim().min(1).max(256) }),
  capabilities: ['sessions', 'library'],
  create: (ctx) =>
    createEmbyLike(ctx, {
      prefix: '',
      headers: { authorization: `MediaBrowser Token="${ctx.credentials.apiKey}"` },
      productCheck: (info) => info.ProductName === undefined || /jellyfin/i.test(String(info.ProductName)),
    }),
});
