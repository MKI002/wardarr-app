// Lookup of adapter definitions by id.
import { ADAPTERS } from '@wardarr/adapters';
import type { AdapterDefinition } from '@wardarr/core';

export class AdapterRegistry {
  private readonly byId: Map<string, AdapterDefinition<Record<string, unknown>>>;

  constructor(definitions: readonly AdapterDefinition<never>[] = ADAPTERS) {
    this.byId = new Map(
      definitions.map((d) => [d.id, d as unknown as AdapterDefinition<Record<string, unknown>>]),
    );
  }

  get(id: string): AdapterDefinition<Record<string, unknown>> | undefined {
    return this.byId.get(id);
  }

  all(): AdapterDefinition<Record<string, unknown>>[] {
    return [...this.byId.values()];
  }
}
