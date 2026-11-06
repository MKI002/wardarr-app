// Subscribes to server-sent events and refreshes the affected queries.
import type { QueryClient } from '@tanstack/react-query';

const INVALIDATES: Record<string, string[][]> = {
  'issues.updated': [['issues'], ['overview']],
  'overview.updated': [['overview'], ['queue'], ['indexers']],
  'cleaner.updated': [['cleaner'], ['cleaner-history'], ['cleaner-preview']],
  'hunting.updated': [['hunting']],
  'library.updated': [['library'], ['stats']],
  'requests.updated': [['requests'], ['discover']],
  'instances.updated': [['instances'], ['overview'], ['capabilities'], ['trash']],
  'trash.updated': [['trash']],
};

export function connectEvents(client: QueryClient): () => void {
  const source = new EventSource('/api/events', { withCredentials: true });
  const handlers = Object.entries(INVALIDATES).map(([type, keys]) => {
    const handler = () => {
      for (const queryKey of keys) void client.invalidateQueries({ queryKey });
    };
    source.addEventListener(type, handler);
    return [type, handler] as const;
  });
  return () => {
    for (const [type, handler] of handlers) source.removeEventListener(type, handler);
    source.close();
  };
}
