// Every language has the same keys and the same placeholders as English.
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LANGUAGES, resources } from '../src/index.js';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}

const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (key: string) => key.replace(PLURAL, '');
const vars = (text: string) => [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

const en = flatten(resources.en.translation as unknown as Tree);

describe.each(SUPPORTED_LANGUAGES.filter((l) => l !== 'en'))('%s', (lang) => {
  const other = flatten((resources as unknown as Record<string, { translation: Tree }>)[lang]!.translation);

  it('has every key English has, and no others', () => {
    const want = new Set(Object.keys(en).map(base));
    const have = new Set(Object.keys(other).map(base));
    expect([...want].filter((k) => !have.has(k))).toEqual([]);
    expect([...have].filter((k) => !want.has(k))).toEqual([]);
  });

  it('keeps the placeholders', () => {
    const wrong = Object.keys(en)
      .filter((k) => k in other && vars(en[k]!).join() !== vars(other[k]!).join())
      .map((k) => `${k}: ${vars(en[k]!).join()} != ${vars(other[k]!).join()}`);
    expect(wrong).toEqual([]);
  });

  it('translates instead of copying English', () => {
    const same = Object.keys(en).filter((k) => other[k] === en[k] && en[k]!.length > 24);
    expect(same).toEqual([]);
  });
});
