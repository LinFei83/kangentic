/**
 * Resolves which locale the renderer runs in.
 *
 * Precedence, highest first:
 *
 * 1. `localStorage['kangentic.language']`, the debug switch. In a DevTools console
 *    run `localStorage.setItem('kangentic.language', 'en')` and reload to see the
 *    app exactly as upstream ships it.
 * 2. `electronAPI.app.initialLanguage`, which main resolved at startup and passed
 *    as a `--kangentic-language=` additionalArgument. A sandboxed preload has no
 *    `process.env`, so the flag is how the choice travels. This is also what keeps
 *    the UI suite and the web demo in English: both run against the mock bridge,
 *    which reports `en`.
 * 3. Chinese, the point of this fork.
 *
 * See docs/i18n-guide.md.
 */

import { LOCALES, type Locale } from '../../shared/i18n';

const STORAGE_KEY = 'kangentic.language';
const DEFAULT_LOCALE: Locale = 'zh-CN';

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    // Storage is unavailable in a sandboxed frame. Fall through to the default.
    return null;
  }
}

export function resolveLocale(): Locale {
  const stored = readStoredLocale();
  if (stored !== null) return stored;
  const fromMain = window.electronAPI?.app?.initialLanguage;
  return isLocale(fromMain) ? fromMain : DEFAULT_LOCALE;
}
