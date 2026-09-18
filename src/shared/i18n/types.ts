/**
 * Types for Kangentic's source-keyed translation layer.
 *
 * The dictionary maps an English string EXACTLY as it appears in the UI to its
 * translation. That is the whole point of this design: the renderer is
 * translated from the outside (src/renderer/i18n/install.ts rewrites the DOM),
 * so no upstream component is edited and tracking upstream stays a plain
 * `git merge`. See docs/i18n-guide.md.
 *
 * A key may contain `{0}`, `{1}`, ... placeholders. Each placeholder matches any
 * run of characters, which is how one entry covers a string the app builds by
 * interpolation: the key `Delete {0} tasks?` translates both
 * "Delete 3 tasks?" and "Delete 41 tasks?".
 */

export type Locale = 'en' | 'zh-CN';

/** Every locale this build ships. 'en' is the untranslated source. */
export const LOCALES: readonly Locale[] = ['en', 'zh-CN'];

/** English source text (with optional `{n}` placeholders) to translation. */
export type Dictionary = Record<string, string>;
