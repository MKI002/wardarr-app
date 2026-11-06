import { defineAdapter } from '@wardarr/core';
import { z } from 'zod';
import { createEmbyLike } from './embyLike.js';

export const emby = defineAdapter({
  id: 'emby',
  name: 'Emby',
  category: 'mediaServer',
  lifecycle: 'active',
  homepage: 'https://emby.media',
  fields: [
    {
      key: 'apiKey',
      kind: 'secret',
      label: 'adapters.fields.apiKey',
      help: 'adapters.help.apiKeyEmby',
      required: true,
    },
  ],
  credentials: z.object({ apiKey: z.string().trim().min(1).max(256) }),
  capabilities: ['sessions', 'library'],
  create: (ctx) =>
    createEmbyLike(ctx, {
      prefix: '/emby',
      headers: { 'X-Emby-Token': ctx.credentials.apiKey },
      productCheck: (info) => !/jellyfin/i.test(String(info.ProductName ?? '')),
    }),
});
