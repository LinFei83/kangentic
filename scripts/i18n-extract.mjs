/**
 * Extracts candidate UI strings from the source tree into i18n-work/candidates.json.
 *
 *   node scripts/i18n-extract.mjs
 *
 * The file is an input to the translation pass and is regenerated on demand. The
 * dictionary itself is hand-maintained; this never edits it. See docs/i18n-guide.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { collectCandidates, CANDIDATES_PATH, REPO_ROOT } from './i18n-lib.mjs';

const { scannedFiles, entries } = collectCandidates();

fs.mkdirSync(path.dirname(CANDIDATES_PATH), { recursive: true });
fs.writeFileSync(
  CANDIDATES_PATH,
  `${JSON.stringify({ scannedFiles, entries }, null, 2)}\n`,
);

const byKind = new Map();
for (const entry of entries) {
  for (const kind of entry.kinds) byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
}

console.log(`scanned ${scannedFiles} files`);
console.log(`candidates: ${entries.length}`);
for (const [kind, count] of [...byKind].sort((left, right) => right[1] - left[1])) {
  console.log(`  ${kind}: ${count}`);
}
console.log(`written to ${path.relative(REPO_ROOT, CANDIDATES_PATH)}`);
