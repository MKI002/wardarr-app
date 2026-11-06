import type { InstanceStatus } from './api';
import type { Tone } from '../components/ui';

export const STATUS_TONE: Record<InstanceStatus, Tone> = {
  ok: 'ok',
  degraded: 'warning',
  down: 'critical',
  unknown: 'neutral',
  disabled: 'neutral',
};

/** Groups items by product, keeping the product order of first appearance. */
export function groupByProduct<T extends { adapter: string }>(
  items: T[],
): Array<{ adapter: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(item.adapter) ?? [];
    list.push(item);
    map.set(item.adapter, list);
  }
  return [...map.entries()].map(([adapter, list]) => ({ adapter, items: list }));
}
