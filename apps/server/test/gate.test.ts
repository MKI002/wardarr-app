// The per-instance gate: a slow heavy read must not mark the instance as down.
import { AdapterError } from '@wardarr/core';
import { describe, expect, it } from 'vitest';
import { InstanceGate } from '../src/jobs/gate.js';

const slow = () => Promise.reject(new AdapterError('timeout', 'slow'));

describe('InstanceGate', () => {
  it('opens the circuit after repeated timeouts', async () => {
    const gate = new InstanceGate({ concurrency: 2, failureThreshold: 2, openMs: 30_000 });
    await expect(gate.run(slow)).rejects.toThrow();
    await expect(gate.run(slow)).rejects.toThrow();
    expect(gate.isOpen).toBe(true);
  });

  it('ignores timeouts of reads that may be slow', async () => {
    const gate = new InstanceGate({ concurrency: 2, failureThreshold: 2, openMs: 30_000 });
    for (let i = 0; i < 3; i++) await expect(gate.run(slow, { trip: false })).rejects.toThrow();
    expect(gate.isOpen).toBe(false);
    // An unreachable instance still counts.
    const down = () => Promise.reject(new AdapterError('unreachable', 'down'));
    await expect(gate.run(down, { trip: false })).rejects.toThrow();
    await expect(gate.run(down, { trip: false })).rejects.toThrow();
    expect(gate.isOpen).toBe(true);
  });
});
