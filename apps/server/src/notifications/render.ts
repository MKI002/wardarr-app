// Renders translatable messages on the server, for notifications. Uses the
// same translation files as the web UI.
import type { Msg } from '@wardarr/core';
import { resources, type Language } from '@wardarr/i18n';

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
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
    params[name] === undefined ? '' : String(params[name]),
  );
}

export function renderMsg(lang: Language, msg: Msg): string {
  return t(lang, msg.key, msg.params);
}
