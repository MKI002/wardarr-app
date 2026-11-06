import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, formatBytes, resources, type Language } from '@wardarr/i18n';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Msg } from '@wardarr/core';

/** Before sign-in, and until a language is chosen, follow the browser. */
function browserLanguage(): Language {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const lang = tag.toLowerCase().split('-')[0] as Language;
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) return lang;
  }
  return DEFAULT_LANGUAGE;
}

i18next.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});

void i18next.use(initReactI18next).init({
  lng: browserLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  resources,
  interpolation: { escapeValue: false },
});
// `{{free, bytes}}` in translations, for example in disk issues.
i18next.services.formatter?.add('bytes', (value: number, lng?: string) => formatBytes(value, lng));

/** Languages that have translations in this build. */
export const AVAILABLE_LANGUAGES = Object.keys(resources);

export function tm(t: (key: string, params?: Record<string, unknown>) => string, msg: Msg): string {
  return t(msg.key, msg.params ?? {});
}

export default i18next;
