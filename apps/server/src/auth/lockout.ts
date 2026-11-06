// Login throttling per user name: after repeated failures the account is
// locked for a while. Combined with per-IP rate limiting on the route.

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

interface Entry {
  failures: number[];
  lockedUntil: number;
}

export class LoginLockout {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  isLocked(username: string): boolean {
    const e = this.entries.get(username.toLowerCase());
    return !!e && e.lockedUntil > this.now();
  }

  fail(username: string): void {
    const key = username.toLowerCase();
    const now = this.now();
    const e = this.entries.get(key) ?? { failures: [], lockedUntil: 0 };
    e.failures = e.failures.filter((t) => now - t < WINDOW_MS);
    e.failures.push(now);
    if (e.failures.length >= MAX_FAILURES) {
      e.lockedUntil = now + LOCK_MS;
      e.failures = [];
    }
    this.entries.set(key, e);
    if (this.entries.size > 10_000) this.prune();
  }

  succeed(username: string): void {
    this.entries.delete(username.toLowerCase());
  }

  private prune(): void {
    const now = this.now();
    for (const [k, e] of this.entries) {
      if (e.lockedUntil < now && e.failures.every((t) => now - t >= WINDOW_MS)) this.entries.delete(k);
    }
  }
}
