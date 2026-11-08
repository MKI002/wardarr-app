// In-process event bus feeding server-sent events.
import { EventEmitter } from 'node:events';

export type Audience = 'admin' | 'all';

export interface WardarrEvent {
  type:
    | 'instances.updated'
    | 'issues.updated'
    | 'overview.updated'
    | 'cleaner.updated'
    | 'hunting.updated'
    | 'library.updated'
    | 'requests.updated'
    | 'trash.updated'
    | 'indexers.updated'
    | 'backups.updated'
    | 'storage.updated'
    | 'quality.updated';
  audience: Audience;
  data?: unknown;
}

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(1000);
  }

  publish(event: WardarrEvent): void {
    this.emitter.emit('event', event);
  }

  subscribe(listener: (event: WardarrEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}
