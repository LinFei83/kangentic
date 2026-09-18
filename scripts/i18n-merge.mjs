/**
 * Merges translation batch files into the shipped dictionary.
 *
 *   node scripts/i18n-merge.mjs [--prune-stale]
 *
 * Reads every i18n-work/batches/*.out.json (a flat English-to-Chinese JSON object),
 * merges it over the entries already in src/shared/i18n/locales/zh-CN.ts, and
 * rewrites that file with every entry sorted by key and one entry per line.
 *
 * A batch entry wins over an existing one, because a batch is newer and was written
 * against the current extraction; the overwrite count is reported so a hand-written
 * entry that a batch disagrees with is visible rather than silent.
 *
 * The rewrite is total, not incremental, because a stable order is what keeps the
 * file reviewable: adding a translation touches one line rather than reshuffling a
 * section. Hand-written entries survive, since the existing file is read first.
 *
 * A batch entry whose value equals its key is dropped: the translator decided the
 * string should stay English, and the dictionary showing it back to itself would
 * only hide that from `npm run i18n:report`.
 *
 * `--prune-stale` additionally drops every entry the source tree no longer renders.
 * That is how obsolete keys are cleaned up after an extraction change.
 *
 * The tree decides that, not the candidate set. The collector leaves two rendered
 * shapes alone by design (a one or two word label its prose probe rejects, and a
 * sentence composed inside a conditional whose branches mix a literal with a template),
 * so pruning on the candidate set alone would delete 83 working entries today. Every
 * key the candidate scan misses is re-checked with `findKeyInTree`, and only a `gone`
 * status is pruned: `rendered` is live copy, and `recased` is a key to fix by hand,
 * since its correct spelling may have no entry of its own. See docs/i18n-guide.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  collectCandidates,
  DICTIONARY_PATH,
  findKeyInTree,
  formatDictionaryEntry,
  readDictionary,
  WORK_DIR,
} from './i18n-lib.mjs';

const HEADER_END = 'export const zhCN: Dictionary = {';

const header = (() => {
  const source = fs.readFileSync(DICTIONARY_PATH, 'utf8');
  const marker = source.indexOf(HEADER_END);
  if (marker === -1) throw new Error(`Could not find "${HEADER_END}" in ${DICTIONARY_PATH}`);
  return source.slice(0, marker + HEADER_END.length);
})();

const { entries: existing } = readDictionary();
const merged = new Map(existing);

const batchDir = path.join(WORK_DIR, 'batches');
const batchFiles = fs.existsSync(batchDir)
  ? fs.readdirSync(batchDir).filter((name) => name.endsWith('.out.json')).sort()
  : [];

let added = 0;
let replaced = 0;
let unchanged = 0;
for (const name of batchFiles) {
  const payload = JSON.parse(fs.readFileSync(path.join(batchDir, name), 'utf8'));
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== 'string' || value.trim().length === 0) continue;
    if (value === key) {
      unchanged += 1;
      continue;
    }
    const trimmedKey = key.trim();
    if (!merged.has(trimmedKey)) added += 1;
    else if (merged.get(trimmedKey) !== value) replaced += 1;
    merged.set(trimmedKey, value);
  }
}

let pruned = 0;
const keptStale = { rendered: 0, recased: 0 };
if (process.argv.includes('--prune-stale')) {
  const { entries: candidates } = collectCandidates();
  const live = new Set(candidates.map((entry) => entry.text));
  for (const key of [...merged.keys()]) {
    if (live.has(key)) continue;
    const { status } = findKeyInTree(key);
    if (status === 'gone') {
      merged.delete(key);
      pruned += 1;
    } else {
      keptStale[status] += 1;
    }
  }
}

// Codepoint order rather than localeCompare, which varies with the installed ICU
// data and would produce a different file on a different machine.
const keys = [...merged.keys()].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

const body = keys.map((key) => formatDictionaryEntry(key, merged.get(key))).join('\n');
fs.writeFileSync(DICTIONARY_PATH, `${header}\n${body}\n};\n`);

console.log(`batches read:  ${batchFiles.length}`);
console.log(`added:         ${added}`);
console.log(`overwritten:   ${replaced}`);
console.log(`left English:  ${unchanged}`);
if (pruned > 0) console.log(`pruned stale:  ${pruned}`);
const kept = keptStale.rendered + keptStale.recased;
if (kept > 0) {
  console.log(`kept stale:    ${kept} (${keptStale.rendered} the tree still renders, `
    + `${keptStale.recased} recased)`);
}
console.log(`total entries: ${keys.length}`);
console.log(`written to ${path.relative(process.cwd(), DICTIONARY_PATH)}`);
