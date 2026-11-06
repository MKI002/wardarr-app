// User accounts and local password identities.
import { and, count, eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { authIdentities, users } from '../db/schema.js';
import { newId } from '../auth/sessions.js';
import type { AuthUser, Role } from '../auth/types.js';
import { hashPassword } from '../security/password.js';

export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,64}$/;

export interface PublicUser {
  id: string;
  username: string;
  displayName: string | null;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

export class UserStore {
  constructor(private readonly db: Db) {}

  count(role?: Role): number {
    const q = this.db.select({ n: count() }).from(users);
    return (role ? q.where(eq(users.role, role)).get() : q.get())?.n ?? 0;
  }

  list(): PublicUser[] {
    return this.db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        disabled: users.disabled,
        createdAt: users.createdAt,
      })
      .from(users)
      .all();
  }

  /** Looks up a user by name together with the local password hash. */
  findLocal(username: string): { user: AuthUser & { disabled: boolean }; passwordHash: string } | null {
    const row = this.db
      .select({ u: users, i: authIdentities })
      .from(users)
      .innerJoin(
        authIdentities,
        and(eq(authIdentities.userId, users.id), eq(authIdentities.provider, 'local')),
      )
      .where(eq(users.username, username.toLowerCase()))
      .get();
    if (!row?.i.passwordHash) return null;
    return {
      user: {
        id: row.u.id,
        username: row.u.username,
        displayName: row.u.displayName,
        role: row.u.role,
        preferences: row.u.preferences,
        disabled: row.u.disabled,
      },
      passwordHash: row.i.passwordHash,
    };
  }

  async createLocal(input: {
    username: string;
    password: string;
    role: Role;
    displayName?: string | null;
  }): Promise<PublicUser> {
    const passwordHash = await hashPassword(input.password);
    const id = newId();
    const username = input.username.toLowerCase();
    this.db.transaction((tx) => {
      tx.insert(users)
        .values({ id, username, displayName: input.displayName ?? null, role: input.role })
        .run();
      tx.insert(authIdentities)
        .values({ id: newId(), userId: id, provider: 'local', subject: username, passwordHash })
        .run();
    });
    return this.list().find((u) => u.id === id)!;
  }

  async setPassword(userId: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    this.db
      .update(authIdentities)
      .set({ passwordHash })
      .where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, 'local')))
      .run();
  }

  update(userId: string, patch: { role?: Role; disabled?: boolean; displayName?: string | null }): void {
    this.db.update(users).set(patch).where(eq(users.id, userId)).run();
  }

  setPreferences(userId: string, preferences: Record<string, unknown>): void {
    this.db.update(users).set({ preferences }).where(eq(users.id, userId)).run();
  }

  delete(userId: string): void {
    this.db.delete(users).where(eq(users.id, userId)).run();
  }
}
