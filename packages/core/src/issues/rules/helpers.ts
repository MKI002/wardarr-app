// Small helpers shared by catalog rules.
import type { InstanceRef, MatchedSignal, Severity, SignalLevel } from '../types.js';

/** Lowercases and collapses whitespace so fingerprints stay stable. */
export function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 32-bit FNV-1a hash as 8 hex characters. Deterministic across runs. */
export function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Replaces volatile parts of a message (numbers, quoted values) for grouping. */
export function normalizeMessage(message: string): string {
  return normalizeKey(message)
    .replace(/"[^"]*"|'[^']*'/g, '"…"')
    .replace(/\d+(?:[.,:]\d+)*/g, '#');
}

export function levelToSeverity(level: SignalLevel): Severity {
  if (level === 'error') return 'critical';
  if (level === 'warning') return 'warning';
  return 'info';
}

export function worstSeverity(levels: Severity[]): Severity {
  if (levels.includes('critical')) return 'critical';
  if (levels.includes('warning')) return 'warning';
  return 'info';
}

/**
 * Splits the list after the last colon of a health message, for example
 * "Indexers unavailable due to failures: A, B" -> ["A", "B"]. Works for
 * localized messages because only the separator matters.
 */
export function listAfterColon(message: string): string[] {
  const idx = message.lastIndexOf(':');
  if (idx < 0) return [];
  return message
    .slice(idx + 1)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Removes a trailing "(Prowlarr)" style suffix that *arr apps add to synced indexers. */
export function stripIndexerSuffix(name: string): string {
  return name.replace(/\s*\((?:prowlarr|jackett|nzbhydra2?)\)\s*$/i, '').trim();
}

export function instanceNames(matches: MatchedSignal<unknown>[]): string {
  return uniqueInstances(matches)
    .map((i) => i.name)
    .join(', ');
}

export function uniqueInstances(matches: MatchedSignal<unknown>[]): InstanceRef[] {
  const seen = new Map<string, InstanceRef>();
  for (const m of matches)
    if (!seen.has(m.signal.instance.id)) seen.set(m.signal.instance.id, m.signal.instance);
  return [...seen.values()];
}
