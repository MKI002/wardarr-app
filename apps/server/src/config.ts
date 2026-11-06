// Runtime configuration from environment variables.
import path from 'node:path';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', 'auto'])
  .optional()
  .transform((v) => (v === undefined || v === 'auto' ? 'auto' : v === 'true' || v === '1'));

const schema = z.object({
  WARDARR_PORT: z.coerce.number().int().min(1).max(65535).default(8484),
  WARDARR_HOST: z.string().default('0.0.0.0'),
  WARDARR_DATA_DIR: z.string().default('./data'),
  /** 32-byte key as base64 or hex. Generated on first start when absent. */
  WARDARR_SECRET_KEY: z.string().optional(),
  /** Trust X-Forwarded-* headers from a reverse proxy. */
  WARDARR_TRUST_PROXY: bool,
  /** Force the Secure cookie flag; `auto` sets it for HTTPS requests. */
  WARDARR_COOKIE_SECURE: bool,
  WARDARR_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Directory with the built web UI. */
  WARDARR_WEB_DIR: z.string().optional(),
  /** Default timeout for calls to connected services, in milliseconds. */
  WARDARR_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(10000),
  /** Address Wardarr is reached at, for links in notifications. Optional. */
  WARDARR_PUBLIC_URL: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//.test(u), 'http or https only')
    .optional(),
});

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  secretKey: string | undefined;
  trustProxy: boolean;
  cookieSecure: boolean | 'auto';
  logLevel: string;
  webDir: string | undefined;
  httpTimeoutMs: number;
  publicUrl: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  return {
    port: parsed.WARDARR_PORT,
    host: parsed.WARDARR_HOST,
    dataDir: path.resolve(parsed.WARDARR_DATA_DIR),
    secretKey: parsed.WARDARR_SECRET_KEY,
    trustProxy: parsed.WARDARR_TRUST_PROXY === true,
    cookieSecure: parsed.WARDARR_COOKIE_SECURE,
    logLevel: parsed.WARDARR_LOG_LEVEL,
    webDir: parsed.WARDARR_WEB_DIR,
    httpTimeoutMs: parsed.WARDARR_HTTP_TIMEOUT_MS,
    publicUrl: parsed.WARDARR_PUBLIC_URL?.replace(/\/+$/, ''),
  };
}
