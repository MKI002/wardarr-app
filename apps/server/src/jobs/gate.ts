// Per-instance isolation: a concurrency limit and a circuit breaker, so a
// slow or dead instance never blocks other instances, jobs or pages.
import { AdapterError } from '@wardarr/core';

export interface GateOptions {
  concurrency: number;
  /** Consecutive failures that open the circuit. */
  failureThreshold: number;
  /** How long the circuit stays open before one trial call, in ms. */
  openMs: number;
  now?: () => number;
}

export class InstanceGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  private failures = 0;
  private openUntil = 0;
  private readonly now: () => number;

  constructor(private readonly opts: GateOptions) {
    this.now = opts.now ?? Date.now;
  }

  get isOpen(): boolean {
    return this.now() < this.openUntil;
  }

  /**
   * Runs `fn` inside the limit. With `trip: false` a timeout does not count
   * towards opening the circuit: heavy reads such as all-time statistics may
   * be slow without the instance being down.
   */
  async run<T>(fn: () => Promise<T>, opts: { trip?: boolean } = {}): Promise<T> {
    if (this.isOpen) throw new AdapterError('unreachable', 'circuit open after repeated failures');
    if (this.active >= this.opts.concurrency) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active++;
    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (err) {
      const counts =
        err instanceof AdapterError &&
        (err.kind === 'unreachable' || (err.kind === 'timeout' && opts.trip !== false));
      if (counts) {
        this.failures++;
        if (this.failures >= this.opts.failureThreshold) this.openUntil = this.now() + this.opts.openMs;
      }
      throw err;
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  /** Closes the circuit, for example after the user changed the URL. */
  reset(): void {
    this.failures = 0;
    this.openUntil = 0;
  }
}
