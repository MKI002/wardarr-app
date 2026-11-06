import { DEFAULT_LANGUAGE, resources } from '@wardarr/i18n';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Msg } from '@wardarr/core';

void i18next.use(initReactI18next).init({
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  resources,
  interpolation: { escapeValue: false },
});

/** Languages that have translations in this build. */
export const AVAILABLE_LANGUAGES = Object.keys(resources);

export function tm(t: (key: string, params?: Record<string, unknown>) => string, msg: Msg): string {
  return t(msg.key, msg.params ?? {});
}

export default i18next;
