// Translation resources. Each JSON file in locales/<lang>/ becomes a top-level
// key, so `locales/en/issues.json` provides `issues.*`.
import enAdapters from '../locales/en/adapters.json' with { type: 'json' };
import enBackups from '../locales/en/backups.json' with { type: 'json' };
import enCalendar from '../locales/en/calendar.json' with { type: 'json' };
import enCleaner from '../locales/en/cleaner.json' with { type: 'json' };
import enCommon from '../locales/en/common.json' with { type: 'json' };
import enHunting from '../locales/en/hunting.json' with { type: 'json' };
import enInsights from '../locales/en/insights.json' with { type: 'json' };
import enIssues from '../locales/en/issues.json' with { type: 'json' };
import enNotifications from '../locales/en/notifications.json' with { type: 'json' };
import enTrash from '../locales/en/trash.json' with { type: 'json' };
import enUi from '../locales/en/ui.json' with { type: 'json' };
import deAdapters from '../locales/de/adapters.json' with { type: 'json' };
import deBackups from '../locales/de/backups.json' with { type: 'json' };
import deCalendar from '../locales/de/calendar.json' with { type: 'json' };
import deCleaner from '../locales/de/cleaner.json' with { type: 'json' };
import deCommon from '../locales/de/common.json' with { type: 'json' };
import deHunting from '../locales/de/hunting.json' with { type: 'json' };
import deInsights from '../locales/de/insights.json' with { type: 'json' };
import deIssues from '../locales/de/issues.json' with { type: 'json' };
import deNotifications from '../locales/de/notifications.json' with { type: 'json' };
import deTrash from '../locales/de/trash.json' with { type: 'json' };
import deUi from '../locales/de/ui.json' with { type: 'json' };

export const SUPPORTED_LANGUAGES = ['en', 'de'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'en';

export const resources = {
  en: {
    translation: {
      issues: enIssues,
      common: enCommon,
      adapters: enAdapters,
      ui: enUi,
      cleaner: enCleaner,
      hunting: enHunting,
      notifications: enNotifications,
      trash: enTrash,
      insights: enInsights,
      backups: enBackups,
      calendar: enCalendar,
    },
  },
  de: {
    translation: {
      issues: deIssues,
      common: deCommon,
      adapters: deAdapters,
      ui: deUi,
      cleaner: deCleaner,
      hunting: deHunting,
      notifications: deNotifications,
      trash: deTrash,
      insights: deInsights,
      backups: deBackups,
      calendar: deCalendar,
    },
  },
} as const;

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/**
 * Formats a byte count for people, in binary steps with the language's
 * decimal separator: 1.2 TB, 1,2 TB. Used through `{{value, bytes}}` in
 * translations, on the web and in notifications.
 */
export function formatBytes(bytes: number, lang: string = DEFAULT_LANGUAGE): string {
  if (!Number.isFinite(bytes)) return '–';
  let v = Math.abs(bytes);
  let i = 0;
  while (v >= 1024 && i < BYTE_UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = v >= 100 || i === 0 ? 0 : 1;
  const text = new Intl.NumberFormat(lang, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(v);
  return `${bytes < 0 ? '−' : ''}${text} ${BYTE_UNITS[i]}`;
}
