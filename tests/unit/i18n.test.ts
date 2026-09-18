/**
 * Locks the source-keyed translation layer: how a lookup resolves, and the shape
 * the shipped dictionary has to keep.
 *
 * Coverage is deliberately not asserted here. A missing translation shows English
 * rather than failing, so an entry the fork has not written yet is not a broken
 * build; `npm run i18n:report` is what surfaces that drift after an upstream sync.
 * The one exception is the seeded swimlane names, which that report cannot see at
 * all; see the "seeded board copy" block for why.
 * The last block locks the re-check that keeps that report from calling a live entry
 * stale, and `findKeyInTree` with it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTranslator } from '../../src/shared/i18n/translator';
import {
  dictionaryFor,
  getActiveLocale,
  isDroppablePluralSuffix,
  setActiveLocale,
  translate,
  translator,
} from '../../src/shared/i18n';
import { zhCN } from '../../src/shared/i18n/locales/zh-CN';
import { DEFAULT_SWIMLANES } from '../../src/main/db/migrations/default-data';
import { findKeyInTree, notCopyReason, splitUntranslated } from '../../scripts/i18n-lib.mjs';

describe('source-keyed translator', () => {
  it('returns the input unchanged when nothing matches', () => {
    const t = createTranslator({ Save: '保存' });
    expect(t.translate('Delete')).toBe('Delete');
    expect(t.translate('a whole sentence nothing covers')).toBe(
      'a whole sentence nothing covers',
    );
  });

  it('matches an exact key', () => {
    const t = createTranslator({ Save: '保存' });
    expect(t.translate('Save')).toBe('保存');
    expect(t.has('Save')).toBe(true);
    expect(t.has('Save now')).toBe(false);
  });

  it('fills a placeholder from the matched text', () => {
    const t = createTranslator({ 'Delete {0} tasks?': '删除 {0} 个任务？' });
    expect(t.translate('Delete 3 tasks?')).toBe('删除 3 个任务？');
    expect(t.translate('Delete 41 tasks?')).toBe('删除 41 个任务？');
    expect(t.translate('Delete 0 tasks?')).toBe('删除 0 个任务？');
  });

  it('keeps trailing literal text out of the placeholder', () => {
    // The capture is lazy, so the literal tail wins rather than being swallowed.
    const t = createTranslator({ 'Delete {0} tasks?': '删除 {0} 个任务？' });
    expect(t.translate('Delete 2 tasks?')).toBe('删除 2 个任务？');
    expect(t.translate('Delete tasks?')).toBe('Delete tasks?');
  });

  it('finds a pattern regardless of which word the anchor is picked from', () => {
    const t = createTranslator({
      '{0} files changed': '{0} 个文件已更改',
      'Pushed to {0}': '已推送到 {0}',
    });
    expect(t.translate('12 files changed')).toBe('12 个文件已更改');
    expect(t.translate('Pushed to origin/main')).toBe('已推送到 origin/main');
  });

  it('prefers the most specific pattern when two could match', () => {
    const t = createTranslator({
      '{0} tasks moved': '{0} 个任务已移动',
      'Moved {0} tasks moved': '已移动 {0} 个任务已移动',
    });
    expect(t.translate('Moved 3 tasks moved')).toBe('已移动 3 个任务已移动');
    expect(t.translate('3 tasks moved')).toBe('3 个任务已移动');
  });

  it('leaves a placeholder with no matching capture literal', () => {
    // A value that references a placeholder its key does not declare keeps the
    // literal `{1}` rather than deleting text. The dictionary hygiene check below
    // is what stops that shape from shipping.
    const t = createTranslator({ 'Delete {0}?': '删除 {0}？还有 {1}。' });
    expect(t.translate('Delete a?')).toBe('删除 a？还有 {1}。');
  });

  it('ignores text too long to be a UI label', () => {
    const long = `Save ${'x'.repeat(500)}`;
    const t = createTranslator({ [long]: '保存' });
    expect(t.translate(long)).toBe(long);
  });

  it('prefers an anchored pattern over an unanchored one that also fits', () => {
    // `{0} ({1})` has no literal word, so it is filed as unanchored. It fits
    // "Settings (3)" as well as `Settings ({0})` does, and must lose: a general
    // entry that outranks every specific sibling formats the whole app.
    const t = createTranslator({
      '{0} ({1})': '{0}（{1}）',
      'Settings ({0})': '设置（{0}）',
    });
    expect(t.translate('Settings (3)')).toBe('设置（3）');
    expect(t.translate('Restore (Mod+Shift+M)')).toBe('Restore（Mod+Shift+M）');
  });

  it('treats regexp metacharacters in a key as literals', () => {
    const t = createTranslator({ 'Save (all)?': '全部保存？' });
    expect(t.translate('Save (all)?')).toBe('全部保存？');
    expect(t.translate('Save all?')).toBe('Save all?');
  });
});

describe('plural suffix', () => {
  it('drops a lone `s` beside translated copy', () => {
    // <li>{n} uncommitted file{n !== 1 ? 's' : ''} will be lost</li> renders the
    // suffix as its own text node; Chinese marks no plural, so it has to go.
    expect(isDroppablePluralSuffix('s', '3 个未提交文件')).toBe(true);
  });

  it('keeps it when the surrounding copy is still English', () => {
    // An untranslated row must degrade to a fully English row, never a hybrid.
    expect(isDroppablePluralSuffix('s', '3 uncommitted file')).toBe(false);
  });

  it('only claims the exact suffix', () => {
    expect(isDroppablePluralSuffix(' files', '3 个未提交文件')).toBe(false);
    expect(isDroppablePluralSuffix('S', '3 个未提交文件')).toBe(false);
    expect(isDroppablePluralSuffix('', '3 个未提交文件')).toBe(false);
  });
});

describe('active locale', () => {
  beforeEach(() => {
    setActiveLocale('en');
  });

  it('is the identity when the locale is English', () => {
    expect(getActiveLocale()).toBe('en');
    for (const key of Object.keys(zhCN).slice(0, 20)) {
      expect(translate(key)).toBe(key);
    }
  });

  it('translates once a locale is set', () => {
    setActiveLocale('zh-CN');
    expect(getActiveLocale()).toBe('zh-CN');
    expect(translator().size).toBe(Object.keys(zhCN).length);
  });
});

describe('shipped dictionary', () => {
  const entries = Object.entries(zhCN);

  it('has entries', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('has no empty, whitespace-padded, or untranslated values', () => {
    const offenders = entries
      .filter(([, value]) => value.trim().length === 0 || value !== value.trim())
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it('has trimmed keys', () => {
    const offenders = entries.filter(([key]) => key !== key.trim()).map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it('does not key an entry on a number or a bare symbol', () => {
    // Such a key can only ever match user data (a token count, a percentage).
    const offenders = entries
      .filter(([key]) => !/[A-Za-z]/.test(key))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it('uses sequential placeholders starting at zero', () => {
    const offenders = entries
      .filter(([key]) => {
        const indices = [...key.matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1]));
        return indices.some((index, position) => index !== position);
      })
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it('keeps the placeholder set consistent between key and value', () => {
    const offenders = entries
      .filter(([key, value]) => {
        const inKey = [...key.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort();
        const inValue = [...value.matchAll(/\{(\d+)\}/g)].map((match) => match[1]).sort();
        return inKey.join(',') !== inValue.join(',');
      })
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it('carries no em-dash or en-dash', () => {
    // The repo bans these in authored prose. A Chinese value has no use for one, and
    // the writing-style scan covers only markdown for the quotes below.
    const banned = [0x2014, 0x2013].map((code) => String.fromCharCode(code));
    const offenders = entries
      .filter(([, value]) => banned.some((character) => value.includes(character)))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it('reproduces a curly quote only where its key already carries one', () => {
    // `No settings found for &ldquo;{query}&rdquo;` renders the quotes as their own
    // text nodes, so the value has to open the quote the sibling node closes. That is
    // reproducing the source's punctuation. Inventing a typographic quote where the
    // English used a straight one is what this catches.
    const quotes = [0x2018, 0x2019, 0x201c, 0x201d].map((code) => String.fromCharCode(code));
    const offenders = entries
      .filter(([key, value]) =>
        quotes.some((character) => value.includes(character) && !key.includes(character)))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it('is the dictionary the active locale reads', () => {
    setActiveLocale('zh-CN');
    expect(Object.keys(dictionaryFor('zh-CN')).length).toBe(entries.length);
    setActiveLocale('en');
  });
});

describe('seeded board copy', () => {
  // The one coverage assertion in this file, and the report is why it has to exist.
  // `DEFAULT_SWIMLANES` writes each lane name as an object literal's `name` field, which
  // matches neither `UI_PROPERTY_NAMES` nor `COPY_PROPERTY_SUFFIX`, so the candidate scan
  // never offers it. A lane the dictionary is missing is therefore not a candidate, cannot
  // appear as untranslated, and the report reads a clean 100% while the column sits in
  // English. That is how `Planning` and `Executing` shipped untranslated on a board whose
  // other five columns read Chinese, and no `npm run i18n:report` run said a word.
  //
  // Upstream owns this file, so a new default lane or a rename lands here by merge and
  // fails this test rather than reaching a board. That is the trade against the
  // no-coverage rule above: this is the one place the report's "it surfaces the drift"
  // contract does not hold.
  it('translates every seeded swimlane name', () => {
    const missing = DEFAULT_SWIMLANES
      .map((lane) => lane.name)
      .filter((name) => !(name in zhCN));
    expect(missing).toEqual([]);
  });
});

describe('candidate classifier', () => {
  // The candidate scan is generous on purpose (a skipped label silently stays English),
  // so it offers class lists, URLs, and log lines alongside real UI copy. `notCopyReason`
  // sorts them so the report's percentage and `--max-untranslated` measure copy.
  //
  // Both directions are load-bearing and fail differently. A false negative (copy filed
  // as noise) is the dangerous one: the string never reaches a translator and nothing
  // reports it. A false positive just inflates the denominator and keeps the report red.
  // Every case below is a shape that was misclassified while the rules were written.

  it('keeps a label whose only sin is being one lowercase word', () => {
    // `cost` sits beside `tokens` in the same donut tooltip, and `tokens` is translated.
    // A blanket "bare lowercase word is a compared value" rule swallows it.
    expect(notCopyReason('cost')).toBeNull();
    expect(notCopyReason('View')).toBeNull();
  });

  it('keeps copy whose punctuation looks like Tailwind syntax', () => {
    // The `-` and `%` between two placeholders, and the colon after `here`, each made a
    // whole sentence read as a class list before a structural signal required a letter.
    expect(notCopyReason('{0} - {1}% of cost')).toBeNull();
    expect(notCopyReason('{0} - {1}% of tokens')).toBeNull();
    expect(notCopyReason('{0} automation runs here: {1}')).toBeNull();
  });

  it('keeps a sentence that only borrows a developer spelling', () => {
    expect(notCopyReason('Telemetry: TUI only')).toBeNull();
    expect(notCopyReason('Delete 3 tasks?')).toBeNull();
  });

  it('rejects a class list', () => {
    expect(notCopyReason('flex items-center gap-2')).toBe('class names');
  });

  it('calls a utility sitting beside a placeholder a class list, not a unit', () => {
    // `mt-0.5` matches the acronym shape (`mt` is two letters). The class-list rule has
    // to answer first, or the reason sent to a reviewer is wrong.
    expect(notCopyReason('{0} mt-0.5')).toBe('class names');
  });

  it('rejects a URL, a host, and a path', () => {
    expect(notCopyReason('https://example.com/docs')).toBe('url');
    expect(notCopyReason('localhost:3000')).toBe('host and port');
    expect(notCopyReason('.kangentic/config.json, .kangentic/index.db')).toBe('file path');
  });

  it('rejects an identifier and an environment variable', () => {
    expect(notCopyReason('KANGENTIC_DEV')).toBe('identifier');
    expect(notCopyReason('drag-over')).toBe('identifier');
  });

  it('rejects a product name, and keeps a sentence that mentions one', () => {
    // The name on its own, or badged with a version the source interpolates, is a label.
    // Copy that merely mentions a product is still copy: only the name stays English.
    expect(notCopyReason('VS Code')).toBe('product or brand name');
    expect(notCopyReason('Kangentic v{0}')).toBe('product or brand name');
    expect(notCopyReason('VS Code is not installed')).toBeNull();
  });

  it('rejects a dev-overlay legend entry', () => {
    expect(notCopyReason('stale-thinking 180s')).toBe('state and threshold');
  });

  it('rejects SVG path data without swallowing a size', () => {
    expect(notCopyReason('M12 4 L20 20 Z')).toBe('path data');
    // A bare `1M` satisfied the path-data shape until the regex required two command
    // letters, which would have filed a token count as ink.
    expect(notCopyReason('1M')).toBe('unit or acronym');
  });

  it('rejects a font stack and a library error', () => {
    expect(notCopyReason('Menlo, monospace')).toBe('font stack');
    expect(notCopyReason('useTheme must be used within a ThemeProvider'))
      .toBe('developer error');
  });

  it('rejects a template placeholder and a bare number', () => {
    expect(notCopyReason('{{count}} items')).toBe('template placeholder');
    expect(notCopyReason('42')).toBe('numbers and symbols');
    // The letterless catch-all runs before every shape rule, so a numeric host takes
    // this reason rather than the host-and-port one. Both land in the same bucket.
    expect(notCopyReason('127.0.0.1:3000')).toBe('numbers and symbols');
  });

  it('rejects a main-process log line an explicit list names', () => {
    // Shape rules cannot tell a log line from a sentence, so these are listed in the
    // source with the file that emits them.
    expect(notCopyReason('createWindow ran before startMcpHttpServer settled'))
      .toBe('not user copy, verified in source');
    expect(notCopyReason('git {0}')).toBe('not user copy, verified in source');
  });

  it('drops what the dictionary already carries and partitions the rest', () => {
    const candidates = [
      { text: 'Save', locations: ['src/renderer/Example.tsx:1'] },
      { text: 'Save changes', locations: ['src/renderer/Example.tsx:2'] },
      { text: 'flex items-center', locations: ['src/renderer/Example.tsx:3'] },
    ];
    const dictionary = new Map([['Save', '保存']]);
    const { copy, notCopy } = splitUntranslated(candidates, dictionary);
    expect(copy.map((entry) => entry.text)).toEqual(['Save changes']);
    expect(notCopy).toHaveLength(1);
    expect(notCopy[0].text).toBe('flex items-center');
    expect(notCopy[0].reason).toBe('class names');
    // The location survives both buckets, since that is what a translator works from.
    expect(notCopy[0].locations).toEqual(['src/renderer/Example.tsx:3']);
  });
});

describe('tree verifier', () => {
  // The candidate scan cannot see a short label or a sentence composed inside a
  // conditional, so "not a candidate" does not mean "dead", and `--prune-stale` on the
  // candidate set alone deletes live translations. These pin the re-check against the
  // tree that decides. A tree of its own is injected because the production default
  // reads the repository, and a test that depends on this repo's UI copy is a test that
  // breaks when the copy is edited.
  const tree = (text: string) => [{ file: 'src/renderer/Example.tsx', text }];

  it('finds a literal key', () => {
    expect(findKeyInTree('Save changes', tree('<button>Save changes</button>')).status)
      .toBe('rendered');
  });

  it('finds a key whose placeholder is a template substitution', () => {
    const sources = tree('<span>{`${agent.displayName} not found - click to re-detect`}</span>');
    const result = findKeyInTree('{0} not found - click to re-detect', sources);
    expect(result.status).toBe('rendered');
    expect(result.files).toEqual(['src/renderer/Example.tsx']);
  });

  it('finds a key whose placeholder is a JSX expression container', () => {
    const sources = tree('<span>{count} changes ({total})</span>');
    expect(findKeyInTree('{0} changes ({1})', sources).status).toBe('rendered');
  });

  it('will not satisfy a one-word key from inside a longer word', () => {
    expect(findKeyInTree('Done', tree('<li>Donegal</li>')).status).toBe('gone');
    expect(findKeyInTree('Done', tree('<li>Undone</li>')).status).toBe('gone');
    expect(findKeyInTree('Done', tree('<li>Done</li>')).status).toBe('rendered');
  });

  it('reports the tree spelling when only the case differs', () => {
    const result = findKeyInTree('edit task', tree('<MenuItem>Edit Task</MenuItem>'));
    expect(result.status).toBe('recased');
    expect(result.spellings).toEqual(['Edit Task']);
  });

  it('prefers an exact hit over a differently cased one', () => {
    const sources = tree('<MenuItem>Edit Task</MenuItem><MenuItem>edit task</MenuItem>');
    expect(findKeyInTree('edit task', sources).status).toBe('rendered');
  });

  it('reports a key nothing renders', () => {
    const result = findKeyInTree('a sentence this tree never carried', tree('<p>Hello</p>'));
    expect(result).toEqual({ status: 'gone', files: [], spellings: [] });
  });

  it('reads the live tree when no sources are given', () => {
    // Any string guaranteed to be in the tree would do; the product's own name is the
    // one string this repository will not reword.
    expect(findKeyInTree('Kangentic').files.length).toBeGreaterThan(0);
  });
});
