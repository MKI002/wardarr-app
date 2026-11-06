// Translation resources. Each JSON file in locales/<lang>/ becomes a top-level
// key, so `locales/en/issues.json` provides `issues.*`.
import enIssues from '../locales/en/issues.json' with { type: 'json' };
import enCommon from '../locales/en/common.json' with { type: 'json' };
import enAdapters from '../locales/en/adapters.json' with { type: 'json' };

export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'en';

export const resources = {
  en: { translation: { issues: enIssues, common: enCommon, adapters: enAdapters } },
} as const;
