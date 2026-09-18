/**
 * Installs the DOM translation layer.
 *
 * This is the whole reason the fork can translate its UI without editing a single
 * upstream component, so that `git merge upstream/main` stays conflict-free. It
 * rewrites text and translatable attributes after React has written them, and a
 * MutationObserver re-applies the rewrite whenever React writes again.
 *
 * Why rewriting after React is safe: React compares the props it last rendered
 * against the next ones, so a re-render that produces the SAME string does not
 * touch the DOM at all and the translation stands. A re-render that produces a
 * DIFFERENT string replaces the text, our observer sees the new English, and
 * translates that. Observer callbacks run at the microtask checkpoint, which is
 * before the browser paints, so the swap never shows as a flash of English.
 *
 * Two selector lists, because the two things collide with user data differently:
 *
 * - A translatable ATTRIBUTE only changes when its value is a dictionary key
 *   verbatim. A user's own text essentially never is, so attributes translate
 *   everywhere except an explicit opt-out.
 * - A TEXT node is translated the same way, but user content lives in text nodes,
 *   and a task titled "Review" would collide with the Review column label. So
 *   text inside the content surfaces below is left alone.
 *
 * See docs/i18n-guide.md.
 */

import { isDroppablePluralSuffix, setActiveLocale, translator, type Translator } from '../../shared/i18n';
import { resolveLocale } from './locale';

/** Skip this subtree entirely: no text, no attributes. */
const SKIP_SUBTREE_SELECTOR = [
  'script',
  'style',
  'noscript',
  '.xterm',
  '[data-i18n-skip]',
].join(',');

/**
 * Text inside these is the user's or the agent's, not ours. Attributes on the
 * same elements still translate, so a card's tooltips stay translated even though
 * its title does not.
 *
 * `[data-task-id]` is the board card. It swallows that card's own status labels
 * ("Paused", "Queued...") along with the title, which is the deliberate trade: a
 * task titled "Review" must not be rewritten as the Review column label. Narrow
 * this list if that cost ever outweighs the collision.
 */
const SKIP_TEXT_SELECTOR = [
  '[contenteditable="true"]',
  '[data-task-id]',
  '[data-testid="compact-title"]',
  '[data-testid="task-card-description"]',
  '[data-testid^="conversation-"]',
  // Sidebar project and group names are the user's own, and either can collide with a
  // label. A project folder named "Testing" would take the Testing column's
  // translation, and a group named "Open source" reached the "Open {0}" pattern and
  // rendered as "打开 source". The name is the only text on these rows, so the
  // tooltips and aria-labels on the same elements still translate.
  '[data-testid^="project-row-"]',
  '[data-testid^="project-group-"]',
  '.markdown-body',
  'pre',
  'code',
].join(',');

/** Only values that are dictionary keys change, so this list can be generous. */
const TRANSLATABLE_ATTRIBUTES = [
  'placeholder',
  'title',
  'alt',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'aria-valuetext',
];

interface WalkState {
  /** Set once an ancestor is inside a text-skipped region. */
  readonly skipText: boolean;
}

function translateTextNode(node: Text, active: Translator): void {
  const current = node.nodeValue;
  if (current === null || current.length === 0) return;
  // The English plural suffix JSX renders as its own text node. See plural.ts.
  if (isDroppablePluralSuffix(current, node.parentElement?.textContent ?? '')) {
    node.nodeValue = '';
    return;
  }
  const translated = active.translate(current);
  if (translated !== current) node.nodeValue = translated;
}

function translateAttributes(element: Element, active: Translator): void {
  for (const name of TRANSLATABLE_ATTRIBUTES) {
    const current = element.getAttribute(name);
    if (current === null) continue;
    const translated = active.translate(current);
    if (translated !== current) element.setAttribute(name, translated);
  }
}

function walk(node: Node, state: WalkState, active: Translator): void {
  if (node.nodeType === Node.TEXT_NODE) {
    if (!state.skipText) translateTextNode(node as Text, active);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const element = node as Element;
  if (element.matches(SKIP_SUBTREE_SELECTOR)) return;
  translateAttributes(element, active);

  const childState: WalkState = {
    skipText: state.skipText || element.matches(SKIP_TEXT_SELECTOR),
  };
  for (let child = element.firstChild; child !== null; child = child.nextSibling) {
    walk(child, childState, active);
  }
}

function observeMutations(active: Translator): void {
  new MutationObserver((records) => {
    for (const record of records) {
      const anchor = record.target.nodeType === Node.ELEMENT_NODE
        ? (record.target as Element)
        : record.target.parentElement;
      // Anything under an opted-out subtree is not ours to rewrite.
      if (anchor === null || anchor.closest(SKIP_SUBTREE_SELECTOR) !== null) continue;

      if (record.type === 'attributes') {
        translateAttributes(record.target as Element, active);
        continue;
      }
      if (record.type === 'characterData') {
        const parent = (record.target as Text).parentElement;
        if (parent === null || parent.closest(SKIP_TEXT_SELECTOR) === null) {
          translateTextNode(record.target as Text, active);
        }
        continue;
      }
      const skipText = anchor.closest(SKIP_TEXT_SELECTOR) !== null;
      for (const added of record.addedNodes) walk(added, { skipText }, active);
    }
  }).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: TRANSLATABLE_ATTRIBUTES,
  });
}

/** The document title shows in the OS window chrome, and lives outside <body>. */
function installTitleTranslation(active: Translator): void {
  const titleElement = document.querySelector('head > title');
  if (titleElement === null) return;
  const apply = (): void => {
    const current = titleElement.nodeValue;
    if (current === null) return;
    const translated = active.translate(current);
    if (translated !== current) titleElement.nodeValue = translated;
  };
  apply();
  new MutationObserver(apply).observe(titleElement, { characterData: true, childList: true });
}

export function installDomTranslator(): void {
  const locale = resolveLocale();
  document.documentElement.lang = locale;
  if (locale === 'en' || document.body === null) return;

  setActiveLocale(locale);
  const active = translator();

  observeMutations(active);
  walk(document.body, { skipText: false }, active);
  installTitleTranslation(active);
}
