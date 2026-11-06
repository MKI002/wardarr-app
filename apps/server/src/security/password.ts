// Password hashing with argon2id (OWASP recommended parameters).
import { hash, verify, type Algorithm } from '@node-rs/argon2';

// Algorithm.Argon2id is a const enum; its value is 2.
const OPTIONS = { algorithm: 2 as Algorithm, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 10;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/** A precomputed hash so unknown users take as long as known ones. */
let dummyHash: Promise<string> | undefined;
export function dummyVerify(password: string): Promise<boolean> {
  dummyHash ??= hashPassword('wardarr-timing-equalizer');
  return dummyHash.then((h) => verifyPassword(h, password)).then(() => false);
}
