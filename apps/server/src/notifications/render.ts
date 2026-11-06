// Renders translatable messages on the server, for notifications. Uses the
// same translation files as the web UI.
import type { Msg } from '@wardarr/core';
import { formatBytes, resources, type Language } from '@wardarr/i18n';

type Tree = { [key: string]: string | Tree };

function lookup(tree: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

function translation(lang: Language): Tree {
  const all = resources as unknown as Record<string, { translation: Tree }>;
  return (all[lang] ?? all.en!).translation;
}

/** Looks up `key` (with plural forms) and fills in `{{params}}`. */
export function t(lang: Language, key: string, params: Record<string, string | number> = {}): string {
  const trees = [translation(lang), translation('en')];
  const count = typeof params.count === 'number' ? params.count : undefined;
  let text: string | undefined;
  for (const tree of trees) {
    if (count !== undefined) {
      const form = new Intl.PluralRules(lang).select(count);
      text = lookup(tree, `${key}_${form}`) ?? lookup(tree, `${key}_other`);
    }
    text ??= lookup(tree, key);
    if (text) break;
  }
  if (!text) return key;
  // `{{name}}` or `{{name, bytes}}`, the one format the translations use.
  return text.replace(/\{\{\s*(\w+)\s*(?:,\s*(\w+)\s*)?\}\}/g, (_, name: string, format?: string) => {
    const value = params[name];
    if (value === undefined) return '';
    if (format === 'bytes' && typeof value === 'number') return formatBytes(value, lang);
    return String(value);
  });
}

export function renderMsg(lang: Language, msg: Msg): string {
  return t(lang, msg.key, msg.params);
}
