/**
 * Drops the English plural suffix JSX renders as its own text node.
 *
 * `<li>{count} uncommitted file{count !== 1 ? 's' : ''} will be lost</li>` renders
 * three text nodes: the count, `" uncommitted file"`, and `"s"`. A per-text-node
 * translator can rewrite the middle one, because the dictionary keys it as
 * `uncommitted file`, but the suffix is a lone `s` with no key that could safely
 * cover it (a dictionary entry `'s'` would rewrite every standalone `s` in the app,
 * including attribute values). Left alone the row reads `3 个未提交文件s将丢失`.
 *
 * Chinese marks no plural, so the correct output is nothing at all. The rule is
 * confined to the one shape that produces the artifact: a text node holding exactly
 * `s`, in an element that already shows translated copy. Reading the element's own
 * text is what keeps it honest - an element whose copy stayed English keeps its
 * English `s`, so an untranslated row degrades to a fully English row rather than a
 * half-rewritten one.
 *
 * The DOM walk visits siblings in document order, so the copy to the left of the
 * suffix is already translated by the time the suffix is reached. That ordering is
 * load-bearing, not incidental.
 */

/** A lone plural suffix, the exact text `{n !== 1 ? 's' : ''}` renders. */
const PLURAL_SUFFIX_PATTERN = /^s$/;

/** Any CJK ideograph: proof that this element's copy is being shown in Chinese. */
const CJK_PATTERN = /[一-鿿]/;

export function isDroppablePluralSuffix(text: string, containingText: string): boolean {
  return PLURAL_SUFFIX_PATTERN.test(text) && CJK_PATTERN.test(containingText);
}
