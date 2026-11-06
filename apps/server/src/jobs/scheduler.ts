// Minimal in-process scheduler. Each job runs on its own timer; a failing or
// slow job never delays another one, and a job never overlaps with itself.

export interface JobLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

interface Job {
  id: string;
  intervalMs: number;
  run: () => Promise<void>;
  timer?: NodeJS.Timeout;
  running: boolean;
}

export class Scheduler {
  private readonly jobs = new Map<string, Job>();
  private stopped = false;

  constructor(private readonly log: JobLogger) {}

  /** Registers or replaces a job. The first run happens after `initialDelayMs`. */
  schedule(id: string, intervalMs: number, run: () => Promise<void>, initialDelayMs = 0): void {
    this.cancel(id);
    const job: Job = { id, intervalMs, run, running: false };
    this.jobs.set(id, job);
    this.arm(job, initialDelayMs);
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (job?.timer) clearTimeout(job.timer);
    this.jobs.delete(id);
  }

  /** Runs a job now, unless it is already running. */
  async runNow(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job) await this.execute(job);
  }

  stop(): void {
    this.stopped = true;
    for (const job of this.jobs.values()) if (job.timer) clearTimeout(job.timer);
    this.jobs.clear();
  }

  private arm(job: Job, delayMs: number): void {
    if (this.stopped) return;
    // Small jitter spreads load when many instances share an interval.
    const jitter = Math.floor(Math.random() * Math.min(5000, job.intervalMs / 10));
    job.timer = setTimeout(() => {
      void this.execute(job).finally(() => {
        if (this.jobs.get(job.id) === job) this.arm(job, job.intervalMs);
      });
    }, delayMs + jitter);
    job.timer.unref();
  }

  private async execute(job: Job): Promise<void> {
    if (job.running) return;
    job.running = true;
    try {
      await job.run();
    } catch (err) {
      this.log.warn({ job: job.id, err }, 'job failed');
    } finally {
      job.running = false;
    }
  }
}
