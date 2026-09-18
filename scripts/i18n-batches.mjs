/**
 * Splits the untranslated strings into batch files for a translation pass.
 *
 *   node scripts/i18n-batches.mjs [--size 250]
 *
 * Groups by feature area first, so one batch is usually one screen and keeps its
 * own terminology, then packs areas into batches of roughly `--size` entries. The
 * inputs are read from i18n-work/ and the batches are written back there; nothing
 * here touches the shipped dictionary. See docs/i18n-guide.md.
 *
 * The untranslated set is re-derived here rather than read from the report's
 * i18n-work/untranslated.json, so the copy-versus-noise split comes from
 * `splitUntranslated` in the shared lib instead: a batch has to carry the 30 strings a
 * translator can act on, not the 190 class lists and log lines the candidate scan also
 * offers. Otherwise both filters would need to stay in step by hand.
 */

import fs from 'node:fs';
import path from 'node:path';
import { collectCandidates, readDictionary, splitUntranslated, WORK_DIR } from './i18n-lib.mjs';

const args = process.argv.slice(2);
const sizeIndex = args.indexOf('--size');
const BATCH_SIZE = sizeIndex === -1 ? 250 : Number(args[sizeIndex + 1]);

const { entries: candidates } = collectCandidates();
const { entries: dictionary } = readDictionary();
const { copy: untranslated } = splitUntranslated(candidates, dictionary);

/**
 * The feature area an entry belongs to, which is what keeps a batch coherent.
 * Falls back to the file's directory when the path is not one of the known ones.
 */
function areaOf(entry) {
  const location = entry.locations[0] ?? '';
  const file = location.split(':')[0];
  const segments = file.split('/');
  if (segments[1] === 'main') return segments.slice(0, 3).join('/');
  const componentIndex = segments.indexOf('components');
  if (componentIndex !== -1) return segments.slice(0, componentIndex + 2).join('/');
  return segments.slice(0, 2).join('/');
}

const byArea = new Map();
for (const entry of untranslated) {
  const area = areaOf(entry);
  if (!byArea.has(area)) byArea.set(area, []);
  byArea.get(area).push(entry);
}

const areas = [...byArea].sort((left, right) => right[1].length - left[1].length);
const batches = [];
let current = [];
let currentSize = 0;
for (const [area, entries] of areas) {
  if (currentSize > 0 && currentSize + entries.length > BATCH_SIZE) {
    batches.push(current);
    current = [];
    currentSize = 0;
  }
  current.push({ area, entries });
  currentSize += entries.length;
}
if (current.length > 0) batches.push(current);

const batchDir = path.join(WORK_DIR, 'batches');
fs.rmSync(batchDir, { recursive: true, force: true });
fs.mkdirSync(batchDir, { recursive: true });

batches.forEach((batch, index) => {
  const name = `batch-${String(index + 1).padStart(2, '0')}`;
  const entries = batch.flatMap((group) => group.entries);
  fs.writeFileSync(
    path.join(batchDir, `${name}.in.json`),
    `${JSON.stringify({
      areas: batch.map((group) => group.area),
      entries: entries.map((entry) => ({ text: entry.text, locations: entry.locations })),
    }, null, 2)}\n`,
  );
  console.log(`${name}: ${entries.length} strings  [${batch.map((group) => group.area).join(', ')}]`);
});

console.log(`\n${untranslated.length} untranslated strings in ${batches.length} batches`);
console.log(`written to ${path.relative(process.cwd(), batchDir)}`);
