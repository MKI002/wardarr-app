// Server-side sessions. The cookie holds a random token; the database holds
// only its SHA-256, so a database leak does not expose live sessions.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import type { AuthSession, AuthUser } from './types.js';

export const SESSION_COOKIE = 'wardarr_session';
const IDLE_MS = 14 * 24 * 3600 * 1000;
const ABSOLUTE_MS = 30 * 24 * 3600 * 1000;
const TOUCH_MS = 5 * 60 * 1000;

const digest = (token: string) => createHash('sha256').update(token).digest('hex');

export class SessionStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(userId: string): { token: string; session: AuthSession; expiresAt: Date } {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const now = this.now();
    const expiresAt = new Date(now.getTime() + IDLE_MS);
    const id = digest(token);
    this.db
      .insert(sessions)
      .values({
        id,
        userId,
        csrfToken,
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      })
      .run();
    return { token, session: { id, csrfToken }, expiresAt };
  }

  /** Returns the session and user for a cookie token, extending idle expiry. */
  validate(token: string | undefined): { session: AuthSession; user: AuthUser } | null {
    if (!token || token.length > 128) return null;
    const id = digest(token);
    const row = this.db
      .select({ s: sessions, u: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, id))
      .get();
    if (!row) return null;
    const now = this.now();
    const expired =
      new Date(row.s.expiresAt).getTime() <= now.getTime() ||
      new Date(row.s.createdAt).getTime() + ABSOLUTE_MS <= now.getTime();
    if (expired || row.u.disabled) {
      this.db.delete(sessions).where(eq(sessions.id, id)).run();
      return null;
    }
    if (now.getTime() - new Date(row.s.lastSeenAt).getTime() > TOUCH_MS) {
      const absoluteEnd = new Date(row.s.createdAt).getTime() + ABSOLUTE_MS;
      const expiresAt = new Date(Math.min(now.getTime() + IDLE_MS, absoluteEnd));
      this.db
        .update(sessions)
        .set({ lastSeenAt: now.toISOString(), expiresAt: expiresAt.toISOString() })
        .where(eq(sessions.id, id))
        .run();
    }
    return {
      session: { id, csrfToken: row.s.csrfToken },
      user: {
        id: row.u.id,
        username: row.u.username,
        displayName: row.u.displayName,
        role: row.u.role,
        preferences: row.u.preferences,
      },
    };
  }

  revoke(sessionId: string): void {
    this.db.delete(sessions).where(eq(sessions.id, sessionId)).run();
  }

  revokeAllForUser(userId: string, exceptSessionId?: string): void {
    const all = this.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)).all();
    for (const s of all) if (s.id !== exceptSessionId) this.revoke(s.id);
  }

  purgeExpired(): void {
    this.db.delete(sessions).where(lt(sessions.expiresAt, this.now().toISOString())).run();
  }
}

export function newId(): string {
  return randomUUID();
}
