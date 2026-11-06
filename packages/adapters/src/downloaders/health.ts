// Shared helpers for the health checks of download clients. The issue rules
// for these signals live in @wardarr/core (rules/downloaders.ts).
import { DOWNLOADER_SOURCES, type AdapterContext, type Signal, type SignalLevel } from '@wardarr/core';

type Source = keyof typeof DOWNLOADER_SOURCES;

/** Builds a health signal of a download client. */
export function downloaderSignal(
  ctx: AdapterContext<unknown>,
  adapter: string,
  source: Source,
  level: SignalLevel,
  message: string,
  data?: Record<string, unknown>,
): Signal {
  return {
    origin: 'service',
    instance: { id: ctx.instanceId, name: ctx.instanceName, adapter },
    kind: 'health',
    source: DOWNLOADER_SOURCES[source],
    level,
    message,
    ...(data ? { data } : {}),
  };
}

/** One signal per torrent whose tracker answers with an error. */
export function trackerErrorSignals(
  ctx: AdapterContext<unknown>,
  adapter: string,
  torrents: Array<{ name: string; reason: string }>,
): Signal[] {
  return torrents.map((t) =>
    downloaderSignal(ctx, adapter, 'trackerError', 'warning', `${t.name}: ${t.reason}`, {
      name: t.name,
      reason: t.reason,
    }),
  );
}

/**
 * qBittorrent and Deluge only learn that their port is open when a peer
 * connects in. Right after a start, or with nothing to share, they look
 * firewalled although they are not. A closed port is reported only after it
 * stayed closed for this long while torrents were active.
 */
export const PORT_CLOSED_GRACE_MS = 30 * 60_000;

/** Tracks how long a client has looked firewalled. */
export function portWatch(now: () => number = Date.now) {
  let since: number | null = null;
  return {
    /** Records the current state; true when the port counts as closed. */
    update(firewalled: boolean): boolean {
      if (!firewalled) {
        since = null;
        return false;
      }
      since ??= now();
      return now() - since >= PORT_CLOSED_GRACE_MS;
    },
  };
}
