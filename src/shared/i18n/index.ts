/**
 * Public entry point for Kangentic's translation layer.
 *
 * The active locale lives here so both processes read one answer. The renderer
 * resolves it at boot (src/renderer/i18n/locale.ts) and the DOM translator does
 * the actual rewriting (src/renderer/i18n/install.ts); the main process reads it
 * for the strings it owns, such as OS window titles.
 *
 * English is the identity locale: `translate` returns its input untouched, so the
 * renderer boots correctly even if a dictionary is missing an entry.
 */

import { createTranslator, type Translator } from './translator';
import type { Dictionary, Locale } from './types';
import { zhCN } from './locales/zh-CN';

const DICTIONARIES: Record<Locale, Dictionary> = {
  en: {},
  'zh-CN': zhCN,
};

const EMPTY_TRANSLATOR = createTranslator({});

let activeLocale: Locale = 'en';
let activeTranslator: Translator = EMPTY_TRANSLATOR;

const translators = new Map<Locale, Translator>();

function translatorFor(locale: Locale): Translator {
  if (locale === 'en') return EMPTY_TRANSLATOR;
  const cached = translators.get(locale);
  if (cached !== undefined) return cached;
  const built = createTranslator(DICTIONARIES[locale]);
  translators.set(locale, built);
  return built;
}

export function setActiveLocale(locale: Locale): void {
  activeLocale = locale;
  activeTranslator = translatorFor(locale);
}

export function getActiveLocale(): Locale {
  return activeLocale;
}

/** The translator for the active locale. Identity when the locale is English. */
export function translator(): Translator {
  return activeTranslator;
}

/** Translates `text`, returning it unchanged when the dictionary has no entry. */
export function translate(text: string): string {
  return activeTranslator.translate(text);
}

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

export { createTranslator, isPatternKey } from './translator';
export type { Translator } from './translator';
export { isDroppablePluralSuffix } from './plural';
export { LOCALES } from './types';
export type { Dictionary, Locale } from './types';
