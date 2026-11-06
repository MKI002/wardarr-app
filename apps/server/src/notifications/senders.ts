// How each notification service is called. HTTP senders return the URL and
// request; the service sends it without following redirects, because some
// of these URLs carry a token in the path. E-mail goes out over SMTP.
import { createHmac } from 'node:crypto';
import type { HttpRequest } from '@wardarr/core';
import { z } from 'zod';

export const CHANNEL_KINDS = ['webhook', 'discord', 'ntfy', 'gotify', 'telegram', 'email'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export type NotificationEvent = 'issueOpened' | 'issueResolved' | 'requestPending' | 'test';
export type Level = 'critical' | 'warning' | 'info' | 'ok';

export interface Notification {
  event: NotificationEvent;
  level: Level;
  title: string;
  body: string;
  /** Link into Wardarr, when a public address is configured. */
  url: string | null;
  at: string;
}

export interface Outgoing {
  baseUrl: string;
  request: HttpRequest;
}

const url = z.string().trim().min(1).max(2000);
const address = z.email().max(254);
const hostname = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^(?:[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*|\[[0-9a-fA-F:.]+\])$/);
/** Up to ten addresses, separated by commas, semicolons or spaces. */
const recipients = z
  .string()
  .trim()
  .min(1)
  .max(2600)
  .transform((v) => v.split(/[\s,;]+/).filter(Boolean))
  .pipe(z.array(address).min(1).max(10))
  .transform((list) => list.join(', '));

export const EMAIL_SECURITY = ['starttls', 'tls', 'none'] as const;

/** Public settings and secrets per kind. Secrets are stored encrypted. */
export const KIND_SCHEMAS = {
  webhook: {
    config: z.object({ url }).strict(),
    secret: z.object({ signingSecret: z.string().max(500).optional() }).strict(),
  },
  discord: {
    config: z.object({}).strict(),
    secret: z.object({ webhookUrl: url }).strict(),
  },
  ntfy: {
    config: z
      .object({ server: url.default('https://ntfy.sh'), topic: z.string().trim().min(1).max(200) })
      .strict(),
    secret: z.object({ token: z.string().max(500).optional() }).strict(),
  },
  gotify: {
    config: z.object({ server: url }).strict(),
    secret: z.object({ appToken: z.string().trim().min(1).max(500) }).strict(),
  },
  telegram: {
    config: z.object({ chatId: z.string().trim().min(1).max(100) }).strict(),
    secret: z.object({ botToken: z.string().trim().min(1).max(200) }).strict(),
  },
  email: {
    config: z
      .object({
        host: hostname,
        port: z.coerce.number().int().min(1).max(65535).default(587),
        security: z.enum(EMAIL_SECURITY).default('starttls'),
        username: z.string().trim().max(254).optional(),
        from: address,
        to: recipients,
      })
      .strict(),
    secret: z.object({ password: z.string().max(500).optional() }).strict(),
  },
} as const;

/** Which fields are secret, for the settings form. */
export const SECRET_FIELDS: Record<ChannelKind, string[]> = {
  webhook: ['signingSecret'],
  discord: ['webhookUrl'],
  ntfy: ['token'],
  gotify: ['appToken'],
  telegram: ['botToken'],
  email: ['password'],
};

/** URLs a channel connects to, for the SSRF check when it is saved. */
export function targetUrls(
  kind: ChannelKind,
  config: Record<string, unknown>,
  secret: Record<string, unknown>,
): string[] {
  switch (kind) {
    case 'webhook':
      return [String(config.url)];
    case 'discord':
      return [String(secret.webhookUrl)];
    case 'ntfy':
    case 'gotify':
      return [String(config.server)];
    case 'telegram':
      return ['https://api.telegram.org'];
    case 'email':
      // Only the host matters here; the scheme just makes it a URL to check.
      return [`https://${String(config.host)}`];
  }
}

function split(full: string): { baseUrl: string; path: string } {
  const u = new URL(full);
  return { baseUrl: u.origin, path: `${u.pathname.replace(/\/+$/, '') || ''}${u.search}` || '/' };
}

const COLORS: Record<Level, number> = { critical: 0xd64545, warning: 0xd99a1e, info: 0x5b45e0, ok: 0x1f9d55 };
const PRIORITY: Record<Level, number> = { critical: 5, warning: 4, info: 3, ok: 3 };
const EMOJI: Record<Level, string> = { critical: '🔴', warning: '🟠', info: '🔵', ok: '🟢' };

export type HttpKind = Exclude<ChannelKind, 'email'>;

export function buildRequest(
  kind: HttpKind,
  config: Record<string, unknown>,
  secret: Record<string, unknown>,
  n: Notification,
): Outgoing {
  switch (kind) {
    case 'webhook': {
      const { baseUrl, path } = split(String(config.url));
      const payload = { source: 'wardarr', ...n };
      const headers: Record<string, string> = { 'user-agent': 'Wardarr' };
      if (typeof secret.signingSecret === 'string' && secret.signingSecret) {
        const sig = createHmac('sha256', secret.signingSecret).update(JSON.stringify(payload)).digest('hex');
        headers['x-wardarr-signature'] = `sha256=${sig}`;
      }
      return { baseUrl, request: { method: 'POST', path, headers, json: payload } };
    }
    case 'discord': {
      const { baseUrl, path } = split(String(secret.webhookUrl));
      return {
        baseUrl,
        request: {
          method: 'POST',
          path,
          json: {
            username: 'Wardarr',
            embeds: [
              {
                title: n.title.slice(0, 256),
                description: n.body.slice(0, 4000),
                color: COLORS[n.level],
                timestamp: n.at,
                ...(n.url ? { url: n.url } : {}),
              },
            ],
          },
        },
      };
    }
    case 'ntfy': {
      const { baseUrl, path } = split(String(config.server));
      const headers: Record<string, string> = {};
      if (typeof secret.token === 'string' && secret.token) headers.authorization = `Bearer ${secret.token}`;
      return {
        baseUrl,
        request: {
          method: 'POST',
          path: path === '/' ? '/' : path,
          headers,
          json: {
            topic: config.topic,
            title: n.title,
            message: n.body,
            priority: PRIORITY[n.level],
            tags: ['shield'],
            ...(n.url ? { click: n.url } : {}),
          },
        },
      };
    }
    case 'gotify': {
      const { baseUrl, path } = split(String(config.server));
      return {
        baseUrl,
        request: {
          method: 'POST',
          path: `${path === '/' ? '' : path}/message`,
          headers: { 'x-gotify-key': String(secret.appToken) },
          json: {
            title: n.title,
            message: n.url ? `${n.body}\n\n${n.url}` : n.body,
            priority: PRIORITY[n.level] * 2,
          },
        },
      };
    }
    case 'telegram': {
      return {
        baseUrl: 'https://api.telegram.org',
        request: {
          method: 'POST',
          path: `/bot${String(secret.botToken)}/sendMessage`,
          json: {
            chat_id: config.chatId,
            text: [`${EMOJI[n.level]} ${n.title}`, n.body, n.url].filter(Boolean).join('\n\n'),
            disable_web_page_preview: true,
          },
        },
      };
    }
  }
}

export interface OutgoingMail {
  host: string;
  port: number;
  security: (typeof EMAIL_SECURITY)[number];
  auth: { user: string; pass: string } | null;
  message: { from: string; to: string; subject: string; text: string; html: string };
}

const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const HEX: Record<Level, string> = {
  critical: '#d64545',
  warning: '#d99a1e',
  info: '#5b45e0',
  ok: '#1f9d55',
};

export function buildMail(
  config: Record<string, unknown>,
  secret: Record<string, unknown>,
  n: Notification,
): OutgoingMail {
  const user = typeof config.username === 'string' ? config.username : '';
  const pass = typeof secret.password === 'string' ? secret.password : '';
  const paragraphs = n.body
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p)}</p>`)
    .join('');
  const link = n.url
    ? `<p style="margin:16px 0 0"><a href="${escapeHtml(n.url)}" style="color:#5b45e0">${escapeHtml(n.url)}</a></p>`
    : '';
  return {
    host: String(config.host),
    port: Number(config.port ?? 587),
    security: (config.security as OutgoingMail['security']) ?? 'starttls',
    auth: user ? { user, pass } : null,
    message: {
      from: `Wardarr <${String(config.from)}>`,
      to: String(config.to),
      subject: n.title,
      text: [n.title, n.body, n.url].filter(Boolean).join('\n\n'),
      html:
        `<div style="font-family:system-ui,sans-serif;max-width:560px;border-left:4px solid ${HEX[n.level]};padding:4px 0 4px 16px">` +
        `<h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(n.title)}</h1>${paragraphs}${link}</div>`,
    },
  };
}
