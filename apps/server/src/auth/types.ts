import 'fastify';

export type Role = 'admin' | 'user';
/** Who may call a route. Routes without `access` default to `admin`. */
export type Access = 'public' | 'user' | 'admin';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string | null;
  role: Role;
  preferences: Record<string, unknown>;
}

export interface AuthSession {
  id: string;
  csrfToken: string;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    access?: Access;
  }
  interface FastifyRequest {
    user: AuthUser | null;
    authSession: AuthSession | null;
  }
}
