/**
 * Shared helpers for the i18n tooling.
 *
 * Two things the scripts need and must agree on: the set of UI strings the source
 * tree currently contains, and the dictionary the app actually ships.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DICTIONARY_PATH = path.join(REPO_ROOT, 'src/shared/i18n/locales/zh-CN.ts');
export const WORK_DIR = path.join(REPO_ROOT, 'i18n-work');
export const CANDIDATES_PATH = path.join(WORK_DIR, 'candidates.json');

/** Trees that render user-visible copy. */
const SCAN_ROOTS = ['src/renderer', 'src/shared', 'src/main'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

/**
 * Directories the scan never reads.
 *
 * The translation layer is the one part of the tree whose text is not UI copy. The
 * shipped dictionary is keyed by the English source string, so scanning it offers
 * every key back as a fresh candidate and every Chinese value as an English one, and
 * the next batch pass "translates" the fork's own output. The runtime that consumes
 * the dictionary is skipped with it so the two cannot drift apart.
 */
const SKIP_PREFIXES = [
  'src/shared/i18n/',
  'src/renderer/i18n/',
];

/** Attribute names the DOM translator rewrites. */
const TRANSLATABLE_ATTRIBUTES = new Set([
  'placeholder', 'title', 'alt', 'aria-label', 'aria-description',
  'aria-placeholder', 'aria-valuetext',
]);

/**
 * Object properties whose value reaches the UI from the main process, either as a
 * rendered label (agent modes, board fields) or as a message shown in a toast or
 * dialog (adapter errors).
 */
const UI_PROPERTY_NAMES = new Set([
  'label', 'title', 'message', 'detail', 'description', 'tooltip', 'placeholder',
]);

const MAX_LENGTH = 200;

const NATIVE_ENTITIES = {
  quot: '"', amp: '&', apos: "'", lt: '<', gt: '>', nbsp: ' ',
};

/**
 * What JSX decodes in text and in attribute string literals.
 *
 * A key has to hold the text the DOM actually carries, so `&ldquo;` has to arrive
 * here as a curly quote: keyed raw, the entry stores a reference the DOM never
 * shows and can never match. Babel decodes the whole HTML5 table and this list is
 * partial, so `decodeJsxEntities` throws on a reference it does not know rather
 * than letting a key that can never match pass unnoticed.
 *
 * The values on the right are decoded values, so the curly quotes and symbols here
 * are data, exactly as the curly quotes in the sanitizer regex classes under
 * `src/main/agent/` are.
 */
const NAMED_ENTITIES = {
  ...NATIVE_ENTITIES,
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  bdquo: '„', laquo: '«', raquo: '»',
  bull: '•', middot: '·', hellip: '…',
  copy: '©', reg: '®', trade: '™',
  deg: '°', plusmn: '±', times: '×', divide: '÷', minus: '−',
  euro: '€', pound: '£', yen: '¥', cent: '¢',
  frac12: '½', frac14: '¼', sup2: '²', sup3: '³',
  sect: '§', para: '¶', micro: 'µ',
};

/**
 * JSX decodes HTML entities in text and in attribute string literals, so `&quot;`
 * reaches the DOM as `"` and a key holding the raw source could never match.
 *
 * A reference this table does not know throws rather than passing through. JSX would
 * decode it and the DOM would hold the character, so a candidate keyed on the raw
 * reference is a string that can never be translated, and the report would call its
 * entry stale forever with nothing pointing at the cause. Both call sites below are
 * JSX, which is exactly where Babel does the decoding.
 */
function decodeJsxEntities(text, file) {
  return text.replace(/&(#[Xx]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const codePoint = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return whole;
      return String.fromCodePoint(codePoint);
    }
    const decoded = NAMED_ENTITIES[body];
    if (decoded !== undefined) return decoded;
    throw new Error(
      `${file} uses '&${body};', which JSX decodes before the DOM sees it, but ` +
      `NAMED_ENTITIES in scripts/i18n-lib.mjs does not know it. A candidate keyed on ` +
      `the raw reference can never match, so add '${body}' to that table.`,
    );
  });
}

/**
 * Text an agent reads rather than a person: MCP tool descriptions, the CLI
 * commands the app answers, and the hook protocol payloads. Translating these
 * would confuse the agent and break the MCP contract tests, so only the declared
 * UI properties inside them (an agent mode's `label`, its `description`) are
 * collected.
 *
 * Inside those trees the property NAME has to be restricted too, not just the
 * file. A handler's `message` ("No session found.") and a tool's `description`
 * are wire text returned to the agent, and nothing renders them, so collecting
 * them would leave a hundred candidates the dictionary can never retire. The
 * person-facing copy for the same feature is the separate `label`/`blurb` pair
 * in `src/shared/mcp-tool-manifest.ts`, which this filter does not touch.
 */
const AGENT_FACING_PREFIXES = [
  'src/main/agent/commands/',
  'src/main/agent/mcp-http/',
  'src/main/agent/shared/',
];

/** The only UI property names an agent-facing tree may contribute. */
const AGENT_FACING_PROPERTY_NAMES = new Set(['label', 'title']);

/**
 * Suffixes that mark a prop name as carrying copy rather than a value.
 *
 * The DOM layer rewrites a fixed set of attributes, so a `title` is covered directly.
 * A component prop is the same string one render later, and the prop is rarely named
 * for the attribute it becomes: `confirmLabel`, `submitLabel`, and `helperText` all
 * render text a person reads. The same suffix test governs a parameter default below,
 * so the two rules cannot drift apart.
 */
const COPY_PROPERTY_SUFFIX = /(label|title|text|message|description|placeholder|tooltip)$/i;

/** Whether a prop or attribute of this name holds copy. */
function isCopyPropertyName(name) {
  // A name with no lowercase letter is a constant, not a prop:
  // `src/shared/ipc-channels.ts` names its members `SESSION_SET_TRANSIENT_LABEL` and
  // `CLIPBOARD_WRITE_TEXT`, and their values are channel ids.
  if (!/[a-z]/.test(name)) return false;
  return TRANSLATABLE_ATTRIBUTES.has(name) || UI_PROPERTY_NAMES.has(name) ||
    COPY_PROPERTY_SUFFIX.test(name);
}

/**
 * Keys the translator needs that no literal in the tree carries.
 *
 * The report tells a live entry from a dead one by looking for its English text in
 * the source, and these have none to find: `popupWindowTitleForUrl` RETURNS them,
 * and the only `translate()` call wraps its result, so nothing static connects the
 * two. Without an entry here the report calls them stale and a `--prune-stale`
 * merge deletes them, silently reverting the sign-in popup's title to English.
 */
const RUNTIME_ONLY_KEYS = [
  'Unknown site',
  'Not secure - {0}',
];

/** Drop file paths, URLs, identifiers, and anything else that is not prose. */
function looksLikeProse(text) {
  if (text.length === 0 || text.length > MAX_LENGTH) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (text.includes('://') || text.includes('\\n')) return false;
  if (text.startsWith('--') || text.startsWith('/') || text.startsWith('./')) return false;
  // Log prefixes, interpolated fragments, and code-shaped strings.
  if (text.startsWith('[')) return false;
  if (/[{}<>]/.test(text) || text.includes('=>') || text.includes('->')) return false;
  return true;
}

/** Rejects a Tailwind class list, which is lowercase, hyphenated, and token-dense. */
function looksLikeClassList(text) {
  const tokens = text.trim().split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return false;
  if (!tokens.every((token) => /^[a-z0-9:\-[\]\/._%!&]+$/.test(token))) return false;
  // A phrase can be all-lowercase too ("all changes"), so the shape needs a second
  // signal. Tailwind tokens are distinguished by their structural characters, and
  // one such token is a hyphenated word rather than a utility list.
  return tokens.filter((token) => /[-:[\]/]/.test(token)).length >= 2;
}

function collapseWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Template literals become pattern keys: `Delete ${n} tasks?` -> `Delete {0} tasks?`.
 *
 * A `TemplateSpan`'s `literal` is the text AFTER its expression, so the
 * placeholder is emitted before the literal, not after it. Each expression gets
 * its OWN index: two interpolations in one template are `{0}` and `{1}`, and
 * collapsing them to `{0}` would make the compiled key fill both from the first
 * capture and never match its runtime text.
 */
function templateText(node) {
  let text = node.head.text;
  node.templateSpans.forEach((span, index) => {
    text += `{${index}}`;
    text += span.literal.text;
  });
  return text;
}

/** Cap on branch expansion, so a template with many conditionals cannot explode. */
const MAX_TEMPLATE_VARIANTS = 8;

/** The literal texts a conditional can produce, or null when it needs a placeholder. */
function literalAlternatives(expression) {
  if (!ts.isConditionalExpression(expression)) return null;
  const alternatives = [];
  for (const branch of [expression.whenTrue, expression.whenFalse]) {
    if (ts.isStringLiteral(branch) || ts.isNoSubstitutionTemplateLiteral(branch)) {
      alternatives.push(branch.text);
      continue;
    }
    return null;
  }
  return alternatives;
}

/**
 * Every literal text a template can render.
 *
 * `${n} stroke${n === 1 ? '' : 's'}` renders "1 stroke" or "3 strokes", and one
 * key `{0} stroke{1}` cannot cover both: `{1}`'s capture is always the literal `s`,
 * because the lazy capture never matches empty. The value would then be forced to
 * carry that `{1}` (the dictionary's placeholder parity check requires it) and
 * render "3 笔画s". Expanding the conditional into one key per branch gives
 * `{0} stroke` and `{0} strokes`, and both translate cleanly.
 *
 * A conditional whose branches are not both literals falls back to a placeholder,
 * which is the old behavior and at worst leaves the same suffix artifact.
 */
function templateVariants(node) {
  let variants = [node.head.text];
  let placeholderIndex = 0;
  for (const span of node.templateSpans) {
    const alternatives = literalAlternatives(span.expression);
    const pieces = alternatives ?? [`{${placeholderIndex++}}`];
    const next = [];
    for (const variant of variants) {
      for (const piece of pieces) next.push(variant + piece + span.literal.text);
    }
    if (next.length > MAX_TEMPLATE_VARIANTS) return [templateText(node)];
    variants = next;
  }
  return variants;
}

/**
 * Whether a template's text is copy rather than a class list or a data string.
 *
 * The placeholder is stubbed before the prose probe, because that probe rejects
 * braces and every pattern key has them; it is blanked for the class-list probe,
 * because the stub reads as a capitalised word and would hide a class list.
 */
function looksLikeTemplateSentence(text) {
  if (!looksLikeSentence(text.replace(/\{\d+\}/g, 'X'))) return false;
  return !looksLikeClassList(text.replace(/\{\d+\}/g, ' '));
}

/**
 * The literal texts an attribute initializer or a property value can hold.
 *
 * Three shapes carry copy, and the old rule saw only the first: a plain string
 * (`confirmLabel="Save"`), a braced literal (`label={'Save'}`), and a conditional of
 * two literals (`submitLabel={isEditMode ? 'Save' : 'Create'}`), which renders one word
 * or the other and needs an entry for each. A template contributes its variants when
 * they read as a sentence.
 *
 * A conditional of two words is the shape that matters: `Save` and `Create` are single
 * words, so the renderer literal rule's sentence test rejects both and the dictionary
 * shows them as stale for as long as the tree keeps rendering them.
 */
function copyTexts(initializer) {
  const expression = ts.isJsxExpression(initializer) ? initializer.expression : initializer;
  if (expression === undefined) return [];
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return [expression.text];
  }
  const alternatives = literalAlternatives(expression);
  if (alternatives !== null) return alternatives;
  if (ts.isTemplateExpression(expression)) {
    return templateVariants(expression).filter((variant) => looksLikeTemplateSentence(variant));
  }
  return [];
}

function createCollector() {
  const entries = new Map();

  function add(text, kind, file, line) {
    const value = collapseWhitespace(text);
    if (value.length === 0) return;
    const existing = entries.get(value);
    const location = `${file}:${line}`;
    if (existing === undefined) {
      entries.set(value, { text: value, kinds: [kind], locations: [location] });
      return;
    }
    if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
    if (existing.locations.length < 8) existing.locations.push(location);
  }

  return { entries, add };
}

/**
 * Distinguishes a sentence from a class list, a query, or an identifier chain.
 * Short identifiers have no spaces; Tailwind class lists are all lowercase.
 */
function looksLikeSentence(text) {
  if (!looksLikeProse(text)) return false;
  if (looksLikeClassList(text)) return false;
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return false;
  const hasCapitalisedWord = words.some((word) => /^[A-Z]/.test(word));
  const endsLikeSentence = /[.?!:]$/.test(text.trim());
  return hasCapitalisedWord || endsLikeSentence;
}

function scanFile(filePath, collector) {
  const source = fs.readFileSync(filePath, 'utf8');
  const relative = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
  const isRenderer = relative.startsWith('src/renderer/');
  const isAgentFacing = AGENT_FACING_PREFIXES.some((prefix) => relative.startsWith(prefix));
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  const lineOf = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  function addTemplate(node, kind) {
    for (const variant of templateVariants(node)) {
      if (looksLikeTemplateSentence(variant)) collector.add(variant, kind, relative, lineOf(node));
    }
  }

  function visit(node, inLogCall, inJsx) {
    // JSX text is UI copy by definition.
    if (ts.isJsxText(node)) {
      collector.add(decodeJsxEntities(node.text, relative), 'jsx-text', relative, lineOf(node));
      return;
    }

    // A translatable attribute carries UI copy in its value. The UI property
    // names are collected here too, because a component prop (`confirmLabel`,
    // `message`) is the same string one render later.
    if (ts.isJsxAttribute(node) && node.initializer !== undefined) {
      const name = node.name.getText(sourceFile);
      if (isCopyPropertyName(name)) {
        for (const value of copyTexts(node.initializer)) {
          collector.add(
            decodeJsxEntities(value, relative),
            `jsx-attr:${name}`,
            relative,
            lineOf(node),
          );
        }
      }
    }

    // `confirmLabel = 'Confirm'` in a parameter list is a default the UI renders
    // whenever the caller omits it. Restricted by name, because a default can be
    // anything and only the label-shaped ones are copy.
    if (ts.isParameter(node) && node.initializer !== undefined &&
      isCopyPropertyName(node.name.getText(sourceFile))) {
      const value = node.initializer;
      if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
        collector.add(value.text, 'default-param', relative, lineOf(node));
      }
    }

    // A `translate(...)` call names a string the DOM layer can never reach: a
    // native menu label or a dialog body in the main process.
    if (ts.isCallExpression(node) && node.expression.getText(sourceFile) === 'translate') {
      const [first] = node.arguments;
      if (first !== undefined &&
        (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
        collector.add(first.text, 'translate-call', relative, lineOf(node));
      } else if (first !== undefined && ts.isTemplateExpression(first)) {
        addTemplate(first, 'translate-call');
      }
    }

    // `label: 'Plan (Read-Only)'` and friends feed labels and toasts. These are the
    // one UI-source kind that survives inside an agent-facing tree, because an
    // agent mode's label is shown to the user.
    if (ts.isPropertyAssignment(node)) {
      const name = node.name.getText(sourceFile).replace(/['"]/g, '');
      // Inside an agent-facing tree only `label` and `title` reach a person; the rest
      // of that tree's prose-shaped copy is wire text the agent reads.
      if (isCopyPropertyName(name) && !(isAgentFacing && !AGENT_FACING_PROPERTY_NAMES.has(name))) {
        for (const value of copyTexts(node.initializer)) {
          collector.add(value, `prop:${name}`, relative, lineOf(node));
        }
      }
    }

    // Any prose-shaped literal in the renderer is worth offering for translation.
    // A console argument never is, however prose-shaped it reads.
    if (!inLogCall && !isAgentFacing) {
      if ((isRenderer || inJsx) &&
        (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
        if (looksLikeSentence(node.text)) {
          collector.add(node.text, 'literal', relative, lineOf(node));
        }
      }
      // Templates only where they can be a sentence on their own: a JSX child or
      // an attribute value. A template used to concatenate fragments (`' - ' + label`)
      // is not translatable in isolation, and collecting it produces keys like "- {0}"
      // that could only ever mistranslate.
      if (inJsx && ts.isTemplateExpression(node)) {
        addTemplate(node, 'template');
      }
    }

    const entersLogCall = ts.isCallExpression(node) &&
      node.expression.getText(sourceFile).startsWith('console.');
    const entersJsx = ts.isJsxElement(node) || ts.isJsxFragment(node) ||
      ts.isJsxSelfClosingElement(node);
    ts.forEachChild(node, (child) => visit(child, inLogCall || entersLogCall, inJsx || entersJsx));
  }

  visit(sourceFile, false, false);
}

function collectSourceFiles(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relative = `${path.relative(REPO_ROOT, full).replace(/\\/g, '/')}/`;
    if (SKIP_PREFIXES.some((prefix) => relative.startsWith(prefix))) continue;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      found.push(...collectSourceFiles(full));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      found.push(full);
    }
  }
  return found;
}

/** Every source file the copy scan reads, in a stable order. */
function collectSourceFilesEverywhere() {
  const found = [];
  for (const root of SCAN_ROOTS) {
    const absolute = path.join(REPO_ROOT, root);
    if (!fs.existsSync(absolute)) continue;
    found.push(...collectSourceFiles(absolute));
  }
  return found;
}

/**
 * Every candidate UI string in the tree, over-collected on purpose. The dictionary
 * is keyed by exact English text, so a false positive is inert (nothing in the UI
 * ever matches it) while a false negative is a string that silently stays English.
 */
export function collectCandidates() {
  const collector = createCollector();
  const files = collectSourceFilesEverywhere();
  for (const file of files) scanFile(file, collector);
  for (const key of RUNTIME_ONLY_KEYS) {
    collector.add(key, 'runtime-only', 'scripts/i18n-lib.mjs', 0);
  }
  const entries = [...collector.entries.values()].sort((left, right) =>
    left.text.localeCompare(right.text),
  );
  return { scannedFiles: files.length, entries };
}

const ENTRY_PATTERN = /^\s*'((?:[^'\\]|\\.)*)':\s*'((?:[^'\\]|\\.)*)',?\s*$/;
const SKIPPED_PATTERN = /^\s*(\/\/|\/\*|\*|import\b|export\b|\};?$|$)/;

/**
 * A regexp that finds a dictionary key in a source file.
 *
 * A placeholder is a wildcard rather than a literal, because the tree writes the value
 * where the key writes `{0}`: `` `${name} not found - click to re-detect` `` and
 * `<span>{count} changes ({total})</span>` are the source forms of the keys
 * `{0} not found - click to re-detect` and `{0} changes ({1})`. The `$` is optional
 * because both forms appear, and a JSX expression container is as common as a template
 * substitution.
 *
 * A word character at either end of the key is bounded by its own lookaround, so a
 * one-word key cannot be satisfied by a longer word that merely contains it.
 */
function keyPattern(key, flags) {
  const body = key
    .split(/\{\d+\}/)
    .map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\$?\\{[^}]{0,80}\\}');
  const leading = /^[A-Za-z0-9]/.test(key) ? '(?<![A-Za-z0-9])' : '';
  const trailing = /[A-Za-z0-9]$/.test(key) ? '(?![A-Za-z0-9])' : '';
  return new RegExp(`${leading}${body}${trailing}`, flags);
}

let sourceTexts = null;

/** The text of every file the copy scan reads, read once per process. */
function readSourceTexts() {
  if (sourceTexts !== null) return sourceTexts;
  sourceTexts = collectSourceFilesEverywhere().map((file) => ({
    file: path.relative(REPO_ROOT, file).replace(/\\/g, '/'),
    text: fs.readFileSync(file, 'utf8'),
  }));
  return sourceTexts;
}

/**
 * Every distinct text a pattern matches in the tree, with the files carrying it.
 *
 * `matchAll` clones the regexp, so a global pattern can be reused across calls
 * without the `lastIndex` state a bare `.test()` would carry between them.
 */
function findMatches(pattern, sources) {
  const files = [];
  const spellings = new Set();
  for (const source of sources) {
    const matches = [...source.text.matchAll(pattern)];
    if (matches.length === 0) continue;
    files.push(source.file);
    for (const match of matches) spellings.add(match[0]);
  }
  return { files, spellings: [...spellings] };
}

/**
 * Whether the tree still carries a dictionary key, and in which spelling.
 *
 * A key absent from the candidate set is not necessarily dead. The collector leaves
 * two shapes alone by design, and both are rendered:
 *
 *   - a one or two word label, which the prose probe rejects as too short to be copy
 *     (`Save changes`, `Loading...`, and the default swimlane names)
 *   - a sentence composed inside a conditional whose branches mix a literal with a
 *     template, which has no single stable key to collect
 *
 * So an obsolete entry and a live one look identical to `npm run i18n:report`, and
 * `i18n-merge.mjs --prune-stale` deletes on the candidate set alone. This answers the
 * question the candidate set cannot: is the string still in the tree?
 *
 * `recased` is its own answer rather than a `rendered` or a `gone`, because a key
 * spelled with the wrong capitalisation is a key to fix: it is inert at runtime (the
 * lookup is exact) and it hides the fact that the correct spelling has no entry.
 *
 * The check is deliberately generous, and its failure direction is chosen: a false
 * `rendered` leaves an inert entry the report lists as unverified, while a false `gone`
 * deletes a translation that was working. Case is ignored by the second pass for the
 * same reason.
 *
 * `sources` is injectable so a test can classify against a tree of its own; production
 * callers take the default, which reads every file the copy scan reads, once.
 */
export function findKeyInTree(key, sources = readSourceTexts()) {
  const exact = findMatches(keyPattern(key, 'g'), sources);
  if (exact.files.length > 0) return { status: 'rendered', ...exact };
  const differingByCase = findMatches(keyPattern(key, 'gi'), sources);
  if (differingByCase.files.length > 0) return { status: 'recased', ...differingByCase };
  return { status: 'gone', files: [], spellings: [] };
}

function unescapeTypeScriptLiteral(text) {
  return text.replace(/\\(.)/g, (_, character) => (character === 'n' ? '\n' : character));
}

/**
 * Reads the shipped dictionary by parsing its source. A regexp rather than an
 * import, because this runs under plain `node` and the dictionary is TypeScript.
 * The file's one-entry-per-line format is what makes that safe; a line the parser
 * cannot classify is reported rather than skipped, so a hand-edited entry that
 * breaks the shape fails loudly.
 */
export function readDictionary() {
  const lines = fs.readFileSync(DICTIONARY_PATH, 'utf8').split('\n');
  const entries = new Map();
  const problems = [];

  lines.forEach((line, index) => {
    if (SKIPPED_PATTERN.test(line)) return;
    const match = ENTRY_PATTERN.exec(line);
    if (match === null) {
      problems.push({ line: index + 1, text: line.trim() });
      return;
    }
    const key = unescapeTypeScriptLiteral(match[1]);
    if (!entries.has(key)) entries.set(key, unescapeTypeScriptLiteral(match[2]));
  });

  return { entries, problems };
}

/** Renders one dictionary entry in the shape `readDictionary` expects. */
export function formatDictionaryEntry(key, value) {
  const escape = (text) => text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `  '${escape(key)}': '${escape(value)}',`;
}

/**
 * Product, brand, shell, and agent names, which stay English on purpose.
 *
 * The Shortcuts and Agent tabs list the applications and CLIs installed on the
 * user's machine, and a translated name is harder to find in a Dock, a Start menu,
 * or a `--help` listing than the untranslated one. The brand names are proper nouns.
 *
 * An exact match only, except for a version glued on: `Kangentic v{0}` names the
 * product, while `GitHub is not connected` is a sentence about it and translates.
 */
const PRODUCT_NAMES = new Set([
  'Alacritty', 'Antigravity CLI', 'Asana', 'Azure DevOps', 'Claude Code', 'Codex CLI',
  'Command Prompt', 'Cursor', 'Cursor CLI', 'File Explorer', 'File Manager', 'Finder',
  'Fork', 'Gemini CLI', 'Git Bash', 'GitHub', 'GitHub Copilot CLI', 'GitHub Desktop',
  'GitKraken', 'Goose CLI', 'Grok Build', 'IntelliJ IDEA', 'Kimi Code', 'Kangentic',
  'Oz CLI', 'PowerShell 5', 'PowerShell 7', 'Qwen Code', 'Sublime Text',
  'TortoiseGit Commit', 'TortoiseGit Log', 'VS Code', 'Visual Studio', 'WebStorm',
  'Windows Terminal', 'Zed', 'iTerm2',
]);

/**
 * Candidates that are not UI copy and that no shape rule recognizes.
 *
 * Every entry here was read in the source. They are wire values, shell commands, or
 * main-process diagnostics printed to a log rather than rendered, and translating one
 * would corrupt a command or hide a diagnostic. The three compared values are a
 * `TaskTemplateContextName`, the spawn label of a git child process
 * (`git-spawn.ts`), and a `className` built by a template (`OverseerMascot.tsx`).
 * Kept as an explicit list rather than widened rules, because a rule that guesses
 * wrong marks a real label as "not copy" and the report then never mentions it again.
 * A single lowercase word is the case that forces this: `cost` is a chart label beside
 * the already-translated `tokens`, while `automation` is a value nothing renders, and
 * no shape tells the two apart.
 */
const NOT_COPY_EXCEPTIONS = new Set([
  // Shell commands and their arguments, echoed into a terminal or a hint.
  'exit 0',
  'init script',
  'npm install',
  'wsl hostname -I',
  // Values the code compares or switches on, never rendered.
  'automation',
  'git {0}',
  'overseer {0} {1}',
  // Main-process diagnostics. `src/main/index.ts`, `crash-capture.ts`,
  // `ipc-recorder.ts`, `pty-spawn.ts`, and `expo-push-client.ts` write these to the
  // log or to a crash report; two of them are also thrown as an Error whose stack is
  // what the user sees.
  'CWD does not exist, falling back to home directory',
  'Expo push API responded {0}',
  'GPU process gone: {0}',
  'Parse error',
  'Render process gone: {0}',
  'WebGL re-init failed',
  'WebGL unavailable',
  'createWindow called while a live main window already existed',
  'createWindow ran before startMcpHttpServer settled',
  'embed before init',
  'mainWindow destroyed; push not delivered',
  'second-instance arrived with no live main window; rebuilding',
]);

const PLACEHOLDER = /\{\d+\}/g;

/** The text with every pattern placeholder removed, so shapes can be judged on it. */
function withoutPlaceholders(text) {
  return text.replace(PLACEHOLDER, ' ');
}

/**
 * A Tailwind class list, which the source renders as a string the DOM never shows.
 *
 * The collector's own `looksLikeClassList` has to stay loose, because a false
 * rejection there leaves a missing candidate and a label that silently stays English.
 * This one runs at report time, where the failure direction is reversed: a class list
 * counted as copy is a line of work that never ends, so the test is stricter. Every
 * token has to be lowercase and utility-shaped, and one of them has to carry a
 * structural character (`-`, `:`, `[`, `/`), or the whole list has to be bare layout
 * words, which is what `truncate {0}` and `bottom {0}` are.
 *
 * Two things keep a real label out of it. A signal character only counts inside a
 * token that also has letters and does not end with the character, so `{1}% of cost`
 * is punctuation between words rather than a `%`-attachment, and `{1} automation runs
 * here: {2}` is a colon that ends a word. And the signal has to appear at all: an
 * all-lowercase phrase with no structural token is prose, which is what
 * `looksLikeClassList`'s own two-token threshold never allowed for.
 */
const CLASS_TOKEN = /^@?[-a-z0-9:/.\[\]()_%!&+*,]+$/;
const CLASS_SIGNAL = /[-:[\]/.@#%]/;
const BARE_LAYOUT_WORDS = new Set([
  'absolute', 'block', 'bottom', 'contents', 'flex', 'grid', 'hidden', 'inline',
  'invisible', 'left', 'relative', 'right', 'static', 'sticky', 'top', 'truncate',
  'visible',
]);

/** Whether a token carries Tailwind's structural syntax rather than punctuation. */
function hasStructuralSignal(token) {
  if (!/[A-Za-z]/.test(token)) return false;
  return CLASS_SIGNAL.test(token.replace(/[.:,-]+$/, ''));
}

function isClassList(text) {
  const stripped = collapseWhitespace(withoutPlaceholders(text));
  if (stripped.length === 0) return false;
  const tokens = stripped.split(' ');
  if (!tokens.every((token) => CLASS_TOKEN.test(token))) return false;
  if (tokens.some(hasStructuralSignal)) return true;
  return tokens.every((token) => BARE_LAYOUT_WORDS.has(token));
}

/** A unit or an acronym: `ok`, `1M`, `MB)`, `CPU`, `POST`, `HTTP {0}`, `PR #{0}`. */
function isUnitOrAcronym(text) {
  const stripped = collapseWhitespace(withoutPlaceholders(text));
  if (stripped.length === 0) return false;
  const tokens = stripped.split(' ');
  if (tokens.length > 3) return false;
  let lettered = 0;
  for (const token of tokens) {
    const letters = token.replace(/[^A-Za-z]/g, '');
    if (letters.length === 0) continue;
    lettered += 1;
    if (letters.length <= 2 || letters === letters.toUpperCase()) continue;
    return false;
  }
  return lettered > 0;
}

/**
 * An internal state name and its threshold, such as `stuck-pending-tools 5m`.
 *
 * These render on the activity debug overlay's legend, which is a developer surface
 * behind the Developer tab's toggle. The name is an identifier the code and the logs
 * use, so translating it would decouple the legend from both.
 */
const STATE_AND_THRESHOLD = /^[a-z][a-z0-9-]*\s+\d+(?:ms|s|m|h|d)$/;

/**
 * SVG path data (`M {0} {1} L {2} {3}`), which is geometry rather than text.
 *
 * Two command letters, because one of them alone is a unit: `1M` is a model size.
 */
const SVG_PATH_DATA = /^[MLCZmlcz][MLCZmlcz0-9.,\s]*[MLCZmlcz][MLCZmlcz0-9.,\s]*$/;

/** A React context guard, thrown when a hook is used outside its provider. */
const DEVELOPER_ERROR = /^use[A-Z]\w*\s+must be used within\b/;

/** Host and port, as a URL is shown without its scheme. */
const HOST_AND_PORT = /^[a-z0-9.-]+:\d+$/;

/** One or more file paths, separated by commas: `/home/dev/project`, `.env, .env.local`. */
const PATH_LIST = /^[./][\w./<>-]+(?:\s*,\s*[./][\w./<>-]+)*$/;

/** A kebab-case identifier: `auto-fetch`, `project-delete-worktree`. */
const KEBAB_IDENTIFIER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;

/** Whether a text is a product name, optionally with a version glued on. */
function isProductName(text) {
  const trimmed = collapseWhitespace(text);
  if (PRODUCT_NAMES.has(trimmed)) return true;
  for (const name of PRODUCT_NAMES) {
    if (!trimmed.startsWith(`${name} `)) continue;
    if (!/[A-Za-z]{3}/.test(withoutPlaceholders(trimmed.slice(name.length)))) return true;
  }
  return false;
}

/**
 * Why a candidate is not UI copy, or `null` when it is.
 *
 * The collector is deliberately generous: it would rather offer a class name or a log
 * line as a candidate than skip a label, because a skipped label is a string that
 * silently stays English and nothing reports it. That leaves the report counting
 * roughly 190 strings a translator cannot act on alongside the 30 they can, which is
 * the same as reporting nothing. This is where the split happens, and it is a report
 * and batch-pass concern only: the runtime translator keys on exact English text and
 * is unaffected by what this classifies.
 *
 * Rules are ordered so the specific ones answer first, and each returns a short reason
 * that names what it saw. `null` means "this is copy, translate it".
 */
export function notCopyReason(text) {
  if (!/[A-Za-z]/.test(text)) return 'numbers and symbols';
  if (isProductName(text)) return 'product or brand name';
  if (NOT_COPY_EXCEPTIONS.has(text)) return 'not user copy, verified in source';
  if (text.includes('{{')) return 'template placeholder';
  if (text.includes('://')) return 'url';
  if (HOST_AND_PORT.test(text)) return 'host and port';
  if (PATH_LIST.test(text)) return 'file path';
  if (!/\s/.test(text) && text.includes('=')) return 'environment variable';
  if (!/\s/.test(text) && text.includes('_')) return 'identifier';
  if (KEBAB_IDENTIFIER.test(text)) return 'identifier';
  if (SVG_PATH_DATA.test(collapseWhitespace(withoutPlaceholders(text)))) return 'path data';
  if (STATE_AND_THRESHOLD.test(text)) return 'state and threshold';
  if (isClassList(text)) return 'class names';
  if (isUnitOrAcronym(text)) return 'unit or acronym';
  if (/\b(monospace|sans-serif|serif)\s*$/i.test(text)) return 'font stack';
  if (DEVELOPER_ERROR.test(text)) return 'developer error';
  return null;
}

/**
 * The untranslated candidates split into work and noise.
 *
 * Both the report and the batch writer take their list from here rather than each
 * filtering on its own, because `i18n-batches.mjs` re-derives the untranslated set
 * instead of reading the report's file, and two filters would drift.
 */
export function splitUntranslated(candidates, dictionary) {
  const copy = [];
  const notCopy = [];
  for (const entry of candidates) {
    if (dictionary.has(entry.text)) continue;
    const reason = notCopyReason(entry.text);
    if (reason === null) copy.push(entry);
    else notCopy.push({ ...entry, reason });
  }
  return { copy, notCopy };
}
