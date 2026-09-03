/**
 * i18n runtime.
 *
 * Two rules, both enforced rather than documented:
 *
 *  1. `t()` throws on a missing key. A missing translation therefore breaks
 *     `astro build` instead of shipping an English word onto a Polish page.
 *  2. Nothing in a component may be a literal — `scripts/check-i18n.mjs`
 *     refuses a bare string in a text position or in a text-bearing attribute.
 *
 * Catalogues are nested JSON; keys are addressed with dots ("nav.home").
 */
import pl from './pl.json';
import en from './en.json';
import { locales, defaultLocale } from '../../site.config.mjs';

export type Locale = 'pl' | 'en';

const catalogues: Record<string, unknown> = { pl, en };

export const LOCALES = locales as Locale[];
export const DEFAULT_LOCALE = defaultLocale as Locale;

/** Human names of the locales, in their own language. Not translated: a switcher must read natively. */
export const LOCALE_NAMES: Record<Locale, string> = { pl: 'Polski', en: 'English' };
/** BCP-47 tags for <html lang> and hreflang. */
export const LOCALE_TAGS: Record<Locale, string> = { pl: 'pl-PL', en: 'en-GB' };

export function isLocale(value: string | undefined): value is Locale {
  return typeof value === 'string' && (LOCALES as string[]).includes(value);
}

function lookup(catalogue: unknown, key: string): unknown {
  let node: unknown = catalogue;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/**
 * Returns a translator for `lang`.
 *
 * The translator throws (build fails) when the key is absent or is not a
 * string. `params` substitutes `{name}` placeholders; an unresolved
 * placeholder also throws, because a visible `{count}` on a page is a bug that
 * a reader has to report instead of a build that says so.
 */
export function useTranslations(lang: Locale) {
  const catalogue = catalogues[lang];
  if (!catalogue) throw new Error(`i18n: no catalogue for locale "${lang}"`);

  return function t(key: string, params?: Record<string, string | number>): string {
    const value = lookup(catalogue, key);
    if (typeof value !== 'string') {
      throw new Error(`i18n: missing or non-string key "${key}" in catalogue "${lang}"`);
    }
    const rendered = value.replace(/\{(\w+)\}/g, (_match, name: string) => {
      if (!params || !(name in params)) {
        throw new Error(`i18n: key "${key}" (${lang}) needs parameter "${name}"`);
      }
      return String(params[name]);
    });
    return rendered;
  };
}

/**
 * Returns a list-valued entry (arrays of strings: bullet lists, FAQ bodies).
 * Throws when the key is absent or is not an array of strings.
 */
export function useList(lang: Locale) {
  const catalogue = catalogues[lang];
  if (!catalogue) throw new Error(`i18n: no catalogue for locale "${lang}"`);
  return function list(key: string): string[] {
    const value = lookup(catalogue, key);
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
      throw new Error(`i18n: key "${key}" (${lang}) is not a string array`);
    }
    return value as string[];
  };
}

/**
 * Returns an array of flat string records -- the shape used for tables and
 * definition lists, where every row has the same named fields. Throws when a
 * field is missing or is not a string, so a half-translated row fails the build
 * rather than rendering "undefined".
 */
export function useEntries(lang: Locale) {
  const catalogue = catalogues[lang];
  if (!catalogue) throw new Error(`i18n: no catalogue for locale "${lang}"`);
  return function entries(key: string): Record<string, string>[] {
    const value = lookup(catalogue, key);
    if (!Array.isArray(value)) throw new Error(`i18n: key "${key}" (${lang}) is not an array`);
    return value.map((row, index) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`i18n: key "${key}.${index}" (${lang}) is not an object`);
      }
      for (const [field, fieldValue] of Object.entries(row as Record<string, unknown>)) {
        if (typeof fieldValue !== 'string') {
          throw new Error(`i18n: key "${key}.${index}.${field}" (${lang}) is not a string`);
        }
      }
      return row as Record<string, string>;
    });
  };
}

/** Locale-prefixed path helper. `path` is given without a leading locale. */
export function localePath(lang: Locale, path = ''): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  return clean ? `/${lang}/${clean}/` : `/${lang}/`;
}
