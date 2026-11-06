// The backup file: a readable header line and the compressed database.
//
//   WARDARR-BACKUP 1\n
//   {"format":1,...}\n
//   payload
//
// The payload is the gzip-compressed SQLite database. An exported backup can
// be protected with a passphrase: then the payload is encrypted with
// AES-256-GCM under a key derived with scrypt, the header line is the
// additional authenticated data, and the plaintext carries the installation's
// secret key in front of the database, so the backup can be restored on a new
// installation with all credentials intact.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip, gzip, gzipSync } from 'node:zlib';
import type { BackupKind } from '@wardarr/core';

export const MAGIC = 'WARDARR-BACKUP 1\n';
export const EXTENSION = '.wbak';
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'latin1');
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const MAX_HEADER = 64 * 1024;
// scrypt cost: 32 MiB of memory, well under a second on small servers.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1 } as const;

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export interface BackupEncryption {
  cipher: 'aes-256-gcm';
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  /** The plaintext starts with the installation's secret key. */
  includesKey: boolean;
}

export interface BackupHeader {
  format: 1;
  createdAt: string;
  kind: BackupKind;
  appVersion: string;
  /** Hashes of the database migrations applied in this backup, in order. */
  migrations: string[];
  /** Size and SHA-256 of the uncompressed database. */
  dbSize: number;
  sha256: string;
  /** Identifies the secret key the stored credentials are encrypted with. */
  keyId: string;
  encryption: BackupEncryption | null;
}

export class BackupFormatError extends Error {
  constructor(readonly code: 'notABackup' | 'corrupt' | 'passphraseRequired' | 'wrongPassphrase') {
    super(code);
  }
}

/** A short, non-secret fingerprint of a secret key. */
export function keyId(key: Buffer): string {
  return createHmac('sha256', key).update('wardarr backup key id').digest('hex').slice(0, 16);
}

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function isSqlite(data: Buffer): boolean {
  return data.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC);
}

function headerLine(header: BackupHeader): Buffer {
  return Buffer.from(`${MAGIC}${JSON.stringify(header)}\n`, 'utf8');
}

/** Builds an unencrypted backup. */
export async function encodeBackup(header: BackupHeader, db: Buffer): Promise<Buffer> {
  return Buffer.concat([headerLine({ ...header, encryption: null }), await gzipAsync(db)]);
}

/** Blocking variant, for the backup before migrations while the server is not running yet. */
export function encodeBackupSync(header: BackupHeader, db: Buffer): Buffer {
  return Buffer.concat([headerLine({ ...header, encryption: null }), gzipSync(db)]);
}

/** Builds a passphrase-protected backup, optionally carrying the secret key. */
export async function encodeEncryptedBackup(
  header: BackupHeader,
  db: Buffer,
  passphrase: string,
  secretKey: Buffer | null,
): Promise<Buffer> {
  const salt = randomBytes(16);
  const iv = randomBytes(IV_LENGTH);
  const full: BackupHeader = {
    ...header,
    encryption: {
      cipher: 'aes-256-gcm',
      kdf: 'scrypt',
      ...SCRYPT,
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      includesKey: secretKey !== null,
    },
  };
  const line = headerLine(full);
  const key = await deriveKey(passphrase, full.encryption!);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(line);
  const plain = Buffer.concat([secretKey ?? Buffer.alloc(0), await gzipAsync(db)]);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([line, ct, cipher.getAuthTag()]);
}

function deriveKey(passphrase: string, enc: BackupEncryption): Promise<Buffer> {
  return scryptAsync(passphrase.normalize('NFC'), Buffer.from(enc.salt, 'base64'), KEY_LENGTH, {
    N: enc.N,
    r: enc.r,
    p: enc.p,
    maxmem: 128 * enc.N * enc.r * 2,
  });
}

/** Reads the header of a backup file without touching the payload. */
export function decodeHeader(data: Buffer): { header: BackupHeader; line: Buffer; payload: Buffer } {
  if (!data.subarray(0, MAGIC.length).equals(Buffer.from(MAGIC))) throw new BackupFormatError('notABackup');
  const end = data.indexOf(0x0a, MAGIC.length);
  if (end < 0 || end > MAX_HEADER) throw new BackupFormatError('corrupt');
  let header: BackupHeader;
  try {
    header = JSON.parse(data.subarray(MAGIC.length, end).toString('utf8')) as BackupHeader;
  } catch {
    throw new BackupFormatError('corrupt');
  }
  if (header?.format !== 1 || !Array.isArray(header.migrations) || typeof header.sha256 !== 'string') {
    throw new BackupFormatError('corrupt');
  }
  return { header, line: data.subarray(0, end + 1), payload: data.subarray(end + 1) };
}

export interface DecodedBackup {
  header: BackupHeader;
  db: Buffer;
  /** The secret key carried by a passphrase-protected export. */
  secretKey: Buffer | null;
}

/** Decrypts (when needed), decompresses and verifies a backup. */
export async function decodeBackup(data: Buffer, passphrase?: string): Promise<DecodedBackup> {
  const { header, line, payload } = decodeHeader(data);
  let compressed = payload;
  let secretKey: Buffer | null = null;
  if (header.encryption) {
    if (!passphrase) throw new BackupFormatError('passphraseRequired');
    const enc = header.encryption;
    if (enc.cipher !== 'aes-256-gcm' || enc.kdf !== 'scrypt' || payload.length < TAG_LENGTH) {
      throw new BackupFormatError('corrupt');
    }
    const key = await deriveKey(passphrase, enc);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64'));
    decipher.setAAD(line);
    decipher.setAuthTag(payload.subarray(payload.length - TAG_LENGTH));
    let plain: Buffer;
    try {
      plain = Buffer.concat([
        decipher.update(payload.subarray(0, payload.length - TAG_LENGTH)),
        decipher.final(),
      ]);
    } catch {
      throw new BackupFormatError('wrongPassphrase');
    }
    if (enc.includesKey) {
      secretKey = Buffer.from(plain.subarray(0, KEY_LENGTH));
      compressed = plain.subarray(KEY_LENGTH);
    } else compressed = plain;
  }
  let db: Buffer;
  try {
    db = await gunzipAsync(compressed);
  } catch {
    throw new BackupFormatError('corrupt');
  }
  if (db.length !== header.dbSize || sha256(db) !== header.sha256 || !isSqlite(db)) {
    throw new BackupFormatError('corrupt');
  }
  return { header, db, secretKey };
}
