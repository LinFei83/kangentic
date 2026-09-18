/**
 * The main process's locale.
 *
 * The renderer resolves its own locale and rewrites the DOM (see
 * src/renderer/i18n/install.ts). Main owns only the strings the DOM never sees: OS
 * window titles, and the startup dialog for an unreadable global database.
 *
 * One switch, the `KANGENTIC_LANGUAGE` environment variable, decides both
 * processes. Main reads it here and forwards it to every BrowserWindow as an
 * additionalArgument, which the preload exposes as `electronAPI.app.initialLanguage`.
 * The renderer cannot read the environment itself: its preload is sandboxed, and a
 * sandboxed preload gets a `process` polyfill without `env`.
 *
 * Unset means Chinese, which is the point of this fork. The e2e tier launches the
 * real app with `KANGENTIC_LANGUAGE=en`, because upstream's specs assert English
 * copy and its `createTask` helper drives the New Task dialog by button label.
 * See docs/i18n-guide.md.
 */

import { setActiveLocale, type Locale } from '../shared/i18n';

/** additionalArguments flag the preload parses. */
export const LANGUAGE_ARG_PREFIX = '--kangentic-language=';

/** The only locale this fork ships besides the English source. */
const DEFAULT_LOCALE: Locale = 'zh-CN';

export function resolveMainLocale(): Locale {
  return process.env.KANGENTIC_LANGUAGE === 'en' ? 'en' : DEFAULT_LOCALE;
}

/** The additionalArguments entry every BrowserWindow must carry. */
export function languageArgument(): string {
  return `${LANGUAGE_ARG_PREFIX}${resolveMainLocale()}`;
}

export function installMainLocale(): void {
  setActiveLocale(resolveMainLocale());
}

/**
 * Re-exported so main-process code has one import for locale concerns. The strings
 * main owns are native menu labels and dialog copy, which the DOM layer can never
 * reach.
 */
export { translate } from '../shared/i18n';
