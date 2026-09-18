/**
 * Source-keyed translator: English UI text in, translated text out.
 *
 * Two matching modes. An entry whose key has no placeholder is a plain map hit.
 * An entry whose key has `{0}`, `{1}`, ... placeholders compiles to an anchored
 * regexp, so one entry covers every value the app interpolates into that
 * sentence.
 *
 * Pattern matching is indexed, not scanned. `translate` runs for every text node
 * in the app, and a linear walk over a dictionary of a few thousand entries would
 * run millions of regexp tests on a board with a few thousand nodes. Each pattern
 * is filed under one literal word it cannot match without (its anchor); a lookup
 * only tests the patterns filed under words the input actually has.
 */

import type { Dictionary } from './types';

const PLACEHOLDER_SOURCE = '\\{(\\d+)\\}';
const WORD_PATTERN = /[A-Za-z0-9']+/g;

/**
 * Strings longer than this are agent output, a description, or a diff, never a UI
 * label. Bailing early keeps streaming transcript content out of the pattern walk.
 */
const MAX_TRANSLATABLE_LENGTH = 400;

export interface Translator {
  /** Returns `text` unchanged when nothing matches. */
  translate(text: string): string;
  /** True when a dictionary entry (exact or pattern) covers `text`. */
  has(text: string): boolean;
  /** Number of dictionary entries. */
  readonly size: number;
}

interface PatternEntry {
  readonly regex: RegExp;
  readonly translation: string;
}

/** Picks the longest literal word a pattern cannot match without. */
function pickAnchor(literal: string): string | null {
  let longest: string | null = null;
  for (const word of literal.match(WORD_PATTERN) ?? []) {
    if (longest === null || word.length > longest.length) longest = word;
  }
  return longest === null ? null : longest.toLowerCase();
}

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles `Delete {0} tasks?` to `/^Delete ([\s\S]+?) tasks\?$/`. The capture is
 * lazy so the trailing literal wins over the placeholder.
 */
function compilePattern(source: string): RegExp {
  const placeholderPattern = new RegExp(PLACEHOLDER_SOURCE, 'g');
  let body = '';
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = placeholderPattern.exec(source)) !== null) {
    body += escapeForRegExp(source.slice(cursor, match.index));
    body += '([\\s\\S]+?)';
    cursor = match.index + match[0].length;
  }
  body += escapeForRegExp(source.slice(cursor));
  return new RegExp(`^${body}$`);
}

function fillPlaceholders(translation: string, values: RegExpExecArray): string {
  return translation.replace(new RegExp(PLACEHOLDER_SOURCE, 'g'), (whole, index: string) => {
    const captured = values[Number(index) + 1];
    return captured === undefined ? whole : captured;
  });
}

/** An entry is a pattern when its key interpolates a value. */
export function isPatternKey(source: string): boolean {
  return new RegExp(PLACEHOLDER_SOURCE).test(source);
}

export function createTranslator(dictionary: Dictionary): Translator {
  const exact = new Map<string, string>();
  const anchored = new Map<string, PatternEntry[]>();
  const unanchored: PatternEntry[] = [];
  let size = 0;

  for (const [source, translation] of Object.entries(dictionary)) {
    size += 1;
    if (!isPatternKey(source)) {
      exact.set(source, translation);
      continue;
    }
    const entry: PatternEntry = { regex: compilePattern(source), translation };
    const anchor = pickAnchor(source.replace(new RegExp(PLACEHOLDER_SOURCE, 'g'), ' '));
    if (anchor === null) {
      unanchored.push(entry);
      continue;
    }
    const bucket = anchored.get(anchor);
    if (bucket === undefined) anchored.set(anchor, [entry]);
    else bucket.push(entry);
  }

  // Longest regexp first: the more specific entry wins over a general one that
  // happens to bucket under the same anchor.
  const bySpecificity = (left: PatternEntry, right: PatternEntry): number =>
    right.regex.source.length - left.regex.source.length;
  for (const bucket of anchored.values()) bucket.sort(bySpecificity);
  unanchored.sort(bySpecificity);

  function matchPattern(text: string): string | null {
    // Anchored entries are tried first, and the order is load-bearing. An
    // unanchored entry is one whose key has no literal word at all (`{0} ({1})`,
    // `{0}: {1}`), which makes it the most general shape a pattern can have. Trying
    // those first would let the general entry win over every specific sibling that
    // happens to fit the same text, so `Settings ({0})` would never be reached.
    for (const word of text.match(WORD_PATTERN) ?? []) {
      const bucket = anchored.get(word.toLowerCase());
      if (bucket !== undefined) {
        for (const entry of bucket) {
          const values = entry.regex.exec(text);
          if (values !== null) return fillPlaceholders(entry.translation, values);
        }
      }
    }
    for (const entry of unanchored) {
      const values = entry.regex.exec(text);
      if (values !== null) return fillPlaceholders(entry.translation, values);
    }
    return null;
  }

  /**
   * JSX keeps the space around an expression: `<span>Runs on {branch}</span>` is the
   * text node `"Runs on "`, and `<span>{count} left</span>` is `" left"`. The
   * dictionary stores the trimmed sentence, so a lookup retries the trimmed form and
   * puts the original's surrounding whitespace back on the result. Without this the
   * two halves of a sentence never match, and the sentence renders half translated.
   */
  function translateTrimmed(text: string): string | null {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed === text) return null;
    const direct = exact.get(trimmed);
    if (direct !== undefined) return rewrap(text, direct);
    const patterned = matchPattern(trimmed);
    return patterned === null ? null : rewrap(text, patterned);
  }

  function rewrap(original: string, translation: string): string {
    const leading = original.slice(0, original.length - original.trimStart().length);
    const trailing = original.slice(original.trimEnd().length);
    return `${leading}${translation}${trailing}`;
  }

  return {
    size,
    translate(text: string): string {
      if (text.length === 0 || text.length > MAX_TRANSLATABLE_LENGTH) return text;
      const direct = exact.get(text);
      if (direct !== undefined) return direct;
      const trimmed = translateTrimmed(text);
      if (trimmed !== null) return trimmed;
      return matchPattern(text) ?? text;
    },
    has(text: string): boolean {
      if (exact.has(text)) return true;
      const trimmed = text.trim();
      if (trimmed !== text && exact.has(trimmed)) return true;
      return matchPattern(trimmed.length === 0 ? text : trimmed) !== null;
    },
  };
}
