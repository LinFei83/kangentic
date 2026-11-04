/**
 * Production `getForTrigger` callers must pass `appliesTo` from the task's
 * `card_kind`. The two-argument form defaults to `'regular'` and would run the
 * wrong list for a change card.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCAN_ROOT = path.join(REPO_ROOT, 'src', 'main');
const DEFINITION_FILE = path.join('src', 'main', 'db', 'repositories', 'automation-repository.ts');

function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectSourceFiles(fullPath));
    else if (fullPath.endsWith('.ts')) files.push(fullPath);
  }
  return files;
}

function argumentCount(callInner: string): number {
  let depth = 0;
  let count = 1;
  for (const character of callInner) {
    if (character === '(' || character === '[' || character === '{') depth += 1;
    else if (character === ')' || character === ']' || character === '}') depth -= 1;
    else if (character === ',' && depth === 0) count += 1;
  }
  return count;
}

describe('getForTrigger appliesTo wiring', () => {
  it('passes a third argument at every production call site', () => {
    const offenders: string[] = [];
    for (const filePath of collectSourceFiles(SCAN_ROOT)) {
      const relative = path.relative(REPO_ROOT, filePath).replaceAll('\\', '/');
      if (relative === DEFINITION_FILE.replaceAll('\\', '/')) continue;
      const source = fs.readFileSync(filePath, 'utf8');
      const callPattern = /\.getForTrigger\s*\(/g;
      let match: RegExpExecArray | null = callPattern.exec(source);
      while (match) {
        const start = match.index + match[0].length;
        let depth = 1;
        let index = start;
        while (index < source.length && depth > 0) {
          const character = source[index];
          if (character === '(') depth += 1;
          else if (character === ')') depth -= 1;
          index += 1;
        }
        const inner = source.slice(start, index - 1);
        if (argumentCount(inner) < 3) {
          const line = source.slice(0, match.index).split('\n').length;
          offenders.push(`${relative}:${line}`);
        }
        match = callPattern.exec(source);
      }
    }

    expect(offenders, 'getForTrigger must pass appliesTo as a third argument').toEqual([]);
  });
});
