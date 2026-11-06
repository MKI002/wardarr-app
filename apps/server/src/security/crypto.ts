// AES-256-GCM encryption for stored credentials.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const VERSION = 'v1';
const KEY_FILE = 'secret.key';

export interface SecretBox {
  encrypt(plaintext: string, aad: string): string;
  decrypt(payload: string, aad: string): string;
}

function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const buf = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (buf.length !== 32) throw new Error('WARDARR_SECRET_KEY must be 32 bytes, encoded as base64 or hex');
  return buf;
}

/**
 * Loads the key from the environment, or from the key file in the data
 * directory. Creates the file with mode 0600 on first start.
 */
export function loadOrCreateKey(dataDir: string, envKey: string | undefined): Buffer {
  if (envKey) return parseKey(envKey);
  const file = path.join(dataDir, KEY_FILE);
  if (existsSync(file)) return parseKey(readFileSync(file, 'utf8'));
  mkdirSync(dataDir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(file, key.toString('base64'), { mode: 0o600, flag: 'wx' });
  chmodSync(file, 0o600);
  return key;
}

/** `aad` binds a ciphertext to its record, so it cannot be moved to another one. */
export function createSecretBox(key: Buffer): SecretBox {
  if (key.length !== 32) throw new Error('key must be 32 bytes');
  return {
    encrypt(plaintext, aad) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
    },
    decrypt(payload, aad) {
      const [version, iv, tag, ct] = payload.split(':');
      if (version !== VERSION || !iv || !tag || ct === undefined) throw new Error('unsupported ciphertext');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
    },
  };
}
