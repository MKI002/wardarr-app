// Renders issue messages with the real English translations, for tests.
import { resources } from '@wardarr/i18n';
import i18next from 'i18next';
import type { Msg } from '../src/index.js';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', resources, interpolation: { escapeValue: false } });

export function t(msg: Msg): string {
  const out = i18n.t(msg.key, msg.params ?? {});
  if (out === msg.key) throw new Error(`Missing translation: ${msg.key}`);
  return out;
}
