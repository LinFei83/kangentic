/**
 * Reports how far the Chinese dictionary has drifted from the source tree.
 *
 * This is the tool you run after `git merge upstream/main`, and it answers the one
 * question that decides what work a sync creates:
 *
 *   - UNTRANSLATED: the tree has a UI string the dictionary does not. New upstream
 *     UI, or a sentence this fork has not covered yet. Add an entry to
 *     src/shared/i18n/locales/zh-CN.ts.
 *   - STALE: the dictionary has an entry the candidate scan cannot find in the tree,
 *     so it may no longer match and the string on screen may have reverted to English.
 *
 * Matching is exact against the normalized key. Template literals are normalized by
 * the extractor to the same `{0}` form the dictionary uses, so a pattern key is
 * compared like any other.
 *
 * A stale entry is not the same as a dead one, and the difference decides whether the
 * entry is work or a trap. The collector leaves two rendered shapes alone by design (a
 * one or two word label the prose probe rejects, and a sentence composed inside a
 * conditional whose branches mix a literal with a template), so `findKeyInTree` re-reads
 * the tree for each stale key and sorts them:
 *
 *   - RENDERED: the string is still there, in the key's own spelling. Kept. No work.
 *   - RECASED: the tree spells it differently, so the entry is inert at runtime. Re-key
 *     it to the tree's spelling, or delete it when that spelling is already translated.
 *   - GONE: nothing in the tree renders the string. Delete the entry.
 *
 * Only the last two are actionable, and only they count toward `--max-stale`. See
 * docs/i18n-guide.md.
 *
 * NOT COPY: the candidate scan is deliberately generous, so most of what it offers is
 * not UI text at all: Tailwind class lists rendered as strings, URLs, environment
 * variables, product names, and main-process log lines. Those are counted separately
 * (`notCopyReason` in scripts/i18n-lib.mjs, one rule per shape) and written to
 * i18n-work/not-copy.json, so `--max-untranslated` and the percentage measure the copy
 * a translator can act on rather than a denominator that never reaches zero.
 *
 *   node scripts/i18n-report.mjs
 *   node scripts/i18n-report.mjs --max-stale 0   # non-zero exit if anything drifted
 *
 * Also writes the untranslated list to i18n-work/untranslated.json, the classified
 * stale list to i18n-work/stale.json, and the rejected candidates with the reason each
 * was rejected to i18n-work/not-copy.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  collectCandidates,
  findKeyInTree,
  formatDictionaryEntry,
  readDictionary,
  REPO_ROOT,
  splitUntranslated,
  WORK_DIR,
} from './i18n-lib.mjs';

/** A path relative to the repository root, as a clickable-looking report line. */
function relative(name) {
  return path.relative(REPO_ROOT, path.join(WORK_DIR, name)).replace(/\\/g, '/');
}

const args = process.argv.slice(2);
const maxStaleIndex = args.indexOf('--max-stale');
const maxStale = maxStaleIndex === -1 ? Number.POSITIVE_INFINITY : Number(args[maxStaleIndex + 1]);
const maxUntranslatedIndex = args.indexOf('--max-untranslated');
const maxUntranslated = maxUntranslatedIndex === -1
  ? Number.POSITIVE_INFINITY
  : Number(args[maxUntranslatedIndex + 1]);

const { entries: candidates } = collectCandidates();
const { entries: dictionary, problems } = readDictionary();

if (problems.length > 0) {
  console.error('src/shared/i18n/locales/zh-CN.ts has lines the parser cannot read:');
  for (const problem of problems) console.error(`  line ${problem.line}: ${problem.text}`);
  console.error('Every entry must be a single line of the form:  \'English\': \'中文\',');
  process.exit(2);
}

const candidateTexts = new Set(candidates.map((entry) => entry.text));
const { copy, notCopy } = splitUntranslated(candidates, dictionary);

const stale = { rendered: [], recased: [], gone: [] };
for (const key of dictionary.keys()) {
  if (candidateTexts.has(key)) continue;
  const found = findKeyInTree(key);
  stale[found.status].push({
    key,
    value: dictionary.get(key),
    spellings: found.spellings,
    fileCount: found.files.length,
    firstFile: found.files[0] ?? null,
  });
}
const actionable = [...stale.recased, ...stale.gone];

fs.mkdirSync(WORK_DIR, { recursive: true });
fs.writeFileSync(path.join(WORK_DIR, 'untranslated.json'), `${JSON.stringify(copy, null, 2)}\n`);
fs.writeFileSync(path.join(WORK_DIR, 'not-copy.json'), `${JSON.stringify(notCopy, null, 2)}\n`);
fs.writeFileSync(path.join(WORK_DIR, 'stale.json'), `${JSON.stringify(stale, null, 2)}\n`);

const copyCandidates = candidates.length - notCopy.length;
const translatedCopy = copyCandidates - copy.length;
const percent = copyCandidates === 0
  ? 100
  : Math.round((translatedCopy / copyCandidates) * 100);

console.log(`candidates:   ${candidates.length}`);
console.log(`dictionary:   ${dictionary.size}`);
console.log(`not copy:     ${notCopy.length}`);
console.log(`translated:   ${translatedCopy} of ${copyCandidates} (${percent}%)`);
console.log(`untranslated: ${copy.length}`);
console.log(
  `stale:        ${stale.rendered.length + actionable.length} `
  + `(${actionable.length} actionable: ${stale.recased.length} recased, ${stale.gone.length} gone)`,
);

if (stale.rendered.length > 0) {
  console.log(`\n${stale.rendered.length} stale entries the tree still renders, which the extractor cannot collect:`);
  console.log('  Nothing to do. The key matches at runtime, so the translation applies.');
  console.log(`  Listed in ${relative('stale.json')} under "rendered".`);
}

if (stale.recased.length > 0) {
  console.log('\nRe-key these (the tree renders the string with different capitalisation):');
  for (const entry of stale.recased) {
    const keys = entry.spellings.filter((spelling) => !spelling.includes('${'));
    const target = keys.length === 1 ? JSON.stringify(keys[0]) : 'see stale.json';
    const translated = keys.length === 1 && dictionary.has(keys[0]);
    console.log(`  ${formatDictionaryEntry(entry.key, entry.value)}`);
    console.log(`      -> ${target}${translated ? ' (already translated, so delete this entry)' : ''}`);
  }
}

if (stale.gone.length > 0) {
  console.log('\nDelete these (nothing in the tree renders the string):');
  for (const entry of stale.gone) {
    console.log(`  ${formatDictionaryEntry(entry.key, entry.value)}`);
  }
}

if (copy.length > 0) {
  console.log(`\nUntranslated written to ${relative('untranslated.json')}`);
}
if (notCopy.length > 0) {
  console.log(`${relative('not-copy.json')} holds the ${notCopy.length} candidates that are not copy, `
    + 'each with the reason it was rejected.');
}

if (copy.length > maxUntranslated || actionable.length > maxStale) {
  process.exit(1);
}
