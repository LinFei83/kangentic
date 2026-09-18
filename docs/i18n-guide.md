# Internationalization guide

This fork shows its interface in Chinese. It does that without editing a single
upstream component, so that `git merge upstream/main` stays a plain merge with no
conflicts. This file explains the mechanism, the translation rules, and what to do
after a sync.

## Why the translation happens at the DOM

The usual approach is to give every string a semantic key and rewrite each
component to call `t('board.addColumn')`. That is precise, and it is the wrong
trade here, twice over:

- **It fights upstream forever.** Every upstream change inside `src/renderer/`
  would collide with the translated copy of that file, on an ongoing basis. A fork
  that does this stops being able to merge upstream within a few releases.
- **It breaks several hundred upstream tests.** `tests/ui/` asserts literal English
  copy in roughly 500 places (`getByText`, `toHaveText`, `getByRole` with a name).
  Rewriting the components rewrites the strings those assertions look for, and the
  test files are upstream's too.

So the English source is left exactly as upstream wrote it, and the translations
live beside it, keyed by the English string. `src/renderer/i18n/install.ts`
rewrites the DOM after React renders it. Upstream's tests keep passing, because
the test environment resolves to English (see "Which locale wins" below).

The cost of this choice is that a dictionary entry is matched by text rather than
by a stable key. Upstream rewording a string silently drops its translation. That
is what `npm run i18n:report` exists to catch.

## The files

| Path | Role |
|---|---|
| `src/shared/i18n/locales/zh-CN.ts` | The dictionary. The only file to edit when translating. |
| `src/shared/i18n/translator.ts` | Lookup: exact keys first, then `{n}` patterns, indexed so a lookup is not a scan. |
| `src/shared/i18n/plural.ts` | Drops the English plural suffix JSX renders as its own text node. |
| `src/shared/i18n/index.ts` | Active locale and the `translate()` both processes read. |
| `src/renderer/i18n/locale.ts` | Decides which locale the renderer runs in. |
| `src/renderer/i18n/install.ts` | The DOM rewrite and its `MutationObserver`. |
| `scripts/i18n-lib.mjs` | Extracts candidate UI strings from the source tree; parses the dictionary; classifies a candidate as copy or noise. |
| `scripts/i18n-extract.mjs` | Writes the candidate list to `i18n-work/candidates.json`. |
| `scripts/i18n-batches.mjs` | Splits the untranslated copy into per-area batch files. |
| `scripts/i18n-merge.mjs` | Merges filled-in batch files back into the dictionary. |
| `scripts/i18n-report.mjs` | Reports untranslated and stale entries. Run this after a sync. |

Only `src/renderer/index.tsx` is modified in upstream's tree, and only to add one
import and one call, placed before the first React render.

## The dictionary

A key is the English string exactly as it appears in the UI. A value is the
Chinese string to show instead.

```ts
'Add column': '添加列',
'Delete {0} tasks?': '删除 {0} 个任务？',
```

A key containing `{0}`, `{1}`, ... is a pattern: each placeholder matches any run
of characters, so one entry covers every value the app interpolates. Use a pattern
only for a sentence the app builds by interpolation. Everything else is an exact
key, which is a map lookup rather than a regexp.

An entry is inert if nothing matches it. Nothing breaks by leaving a doubtful
entry in, and nothing breaks by omitting one either: the English shows through.

## Which locale wins

One switch, the `KANGENTIC_LANGUAGE` environment variable, decides the language for both
processes. `src/main/i18n.ts` reads it (`en` means English, unset or anything else means
Chinese) and forwards the answer to every `BrowserWindow` as a
`--kangentic-language=` additional argument. The preload parses that argument into
`electronAPI.app.initialLanguage`, because a sandboxed preload has no `process.env` to read
itself.

`src/renderer/i18n/locale.ts` resolves in this order:

1. `localStorage['kangentic.language']`. This is the debug switch. In a DevTools
   console run `localStorage.setItem('kangentic.language', 'en')` and reload to see
   the app exactly as upstream ships it.
2. `electronAPI.app.initialLanguage`, which is the environment variable above.
   The headless mock bridge (`tests/ui/mock-electron-api.js`, which the web demo also
   loads) reports `en`, and that is what keeps the UI suite's literal English assertions
   valid and the public demo in English. The e2e tier boots the real app instead of the
   mock, so its helper sets `KANGENTIC_LANGUAGE=en` directly
   (`tests/e2e/helpers.ts`).
3. Chinese.

## What does not get translated

`src/renderer/i18n/install.ts` holds two selector lists, and they exist for
different reasons.

- `SKIP_SUBTREE_SELECTOR` is a full opt-out: `.xterm`, `script`, `style`,
  `noscript`, and anything marked `data-i18n-skip`.
- `SKIP_TEXT_SELECTOR` skips text but still translates attributes. It covers the
  surfaces that render the user's or the agent's own words: `.markdown-body`,
  conversation rows and diffs, `pre`, `code`, `[contenteditable]`, the board card's
  title and description (`[data-task-id]`, `[data-testid="compact-title"]`,
  `[data-testid="task-card-description"]`), and the sidebar's project and group rows
  (`[data-testid^="project-row-"]`, `[data-testid^="project-group-"]`).

Skipping a region is never free, and the price is always the same: the copy inside it
stays English. `[data-task-id]` is the largest case, since the whole card is one region,
so that card's own status labels ("Paused", "Queued...") stay English with it. The
alternative is worse, because the collision runs the other way too. A task titled
"Review" would be rewritten as the Review column label.

The sidebar is where both collisions showed up at once. A project folder named "Testing"
took the Testing column's translation, and a group named "Open source" reached the
`Open {0}` pattern and rendered as `打开 source`. Those two rows render a name and nothing
else, so skipping them costs no copy at all.

That is the test before adding a selector: if the region holds our copy as well as the
user's text, the copy is what pays. Narrow the selector if the trade ever flips.

## What the extractor reads

`npm run i18n:extract` parses `src/renderer`, `src/shared`, and `src/main` with the
TypeScript compiler and offers every string literal, template literal, and JSX text
that looks like prose. Four filters decide what it offers. The bias is to collect more
than needed, since a string the scan skips stays English with nothing reporting it, and
the report throws the surplus away later. Bullet 4 is the one filter that can err the
other way; the shape where it does has its own note under "Known limits".

- **The translation layer itself** (`SKIP_PREFIXES` in `scripts/i18n-lib.mjs`). The
  dictionary is keyed by the English source string, so scanning it would offer every
  key back as a fresh candidate and every Chinese value as an English one, and the next
  batch pass would translate the fork's own output. `src/shared/i18n/` and
  `src/renderer/i18n/` are skipped together so the two halves cannot drift apart.
- **Agent-facing trees.** `src/main/agent/commands/`, `mcp-http/`, and `shared/` hold
  text an agent reads: MCP tool descriptions, command handlers, hook protocol payloads.
  Translating those would confuse the agent and break the MCP contract tests, so only a
  declared UI property inside them (`label`, `title`) is collected.
- **Anything that fails the prose probe.** `looksLikeProse` and `looksLikeClassList`
  reject a string with no ASCII letter, one longer than 200 characters, a URL, a
  `\n`, a leading `[` or `--`, braces, arrows, and a Tailwind class list.
- **The text's own context.** A string is collected when it is JSX text, an attribute in
  `TRANSLATABLE_ATTRIBUTES` (`placeholder`, `title`, `aria-label`, ...), an object
  property in `UI_PROPERTY_NAMES`, or a prop whose name ends in `COPY_PROPERTY_SUFFIX`
  (`confirmLabel`, `helperText`). That last rule is why a dialog's `confirmLabel` counts
  while an IPC channel's `LABEL` constant does not: a name with no lowercase letter is a
  constant, not a prop. The list is also why an object literal's `name` field is invisible
  to the scan, which is how the board's seeded column titles are written. See "Known
  limits" for what that costs.

JSX decodes HTML entities before the DOM ever sees them, so a key written as `&ldquo;`
could never match: the DOM holds the character it decoded to. `decodeJsxEntities` performs
that decoding for both JSX text and attribute literals, and it throws on a reference its
table does not know rather than letting a key that can never match pass unnoticed.

## Known limits

Five limits worth knowing. The first two are visible in the app, neither breaks anything,
and each has a workaround if it ever matters enough. The other three are about what the
report can see rather than what the app renders, and they decide what is safe to prune and
what a sync cannot rely on the report for.

**A sentence built from several sibling text nodes renders partly translated.**
`<li>{n} uncommitted file{n !== 1 ? 's' : ''} will be lost</li>` is three text
nodes, and a per-node translator cannot reorder across them. Chinese word order
happens to match English for most of these, so translating the fragments
individually ("uncommitted file" to `个未提交文件`) reads correctly. What does not
work is a sentence whose Chinese form needs the parts in a different order; there
the fragments read as a list of phrases rather than a sentence. The plural suffix is
handled centrally (`src/shared/i18n/plural.ts`), since a lone `s` is the one fragment
with no defensible dictionary key.

**A pattern value that captures an English word stays English.** `{0} changes ({1})`
matches `Hide` or `Show` and interpolates it verbatim, so the result reads
`Hide变更（Mod+Shift+D）`. Fixing this would mean teaching the translator to
translate its own captures, which needs to know that `{1}` holds a dictionary key
rather than a path or a count. Not worth it for the handful of sites.

**"Stale" does not mean "delete".** The report calls an entry stale when the candidate
scan could not find its English key, which is not the same as the tree not carrying it.
The default swimlane names are the case in point: `DEFAULT_SWIMLANES` in
`src/main/db/migrations/default-data.ts` seeds "To Do", "Planning", and the rest into each
project's database, and the extractor cannot collect an object literal's `name` field, so
they sit in the stale list while being the only reason the board's columns read in
Chinese. The status the report assigns is what tells them apart from a dead entry, and
only two of the three statuses are work. See "After an upstream sync".

**The same blind spot hides a MISSING swimlane.** Because the extractor never collects
those `name` fields, a lane the dictionary does not carry is not reported at all. It is not
a candidate, so it cannot show up as untranslated, and `--max-untranslated` is measured
against a denominator it never entered. Upstream adding an eighth default lane, or renaming
one, would therefore land untranslated while the report reads a clean 100%. That is how
`Planning` and `Executing` shipped English on a board whose other five columns read
Chinese, with every check green.

This is the one place the report's "it surfaces the drift" contract does not hold, so the
unit test asserts it directly instead: the `seeded board copy` block in
`tests/unit/i18n.test.ts` fails, naming the lane, whenever the dictionary is missing a name
in `DEFAULT_SWIMLANES`. That is the whole of the exposure, since a lane a user creates is
theirs to name and needs no translation. Coverage is deliberately not asserted anywhere
else; see the note at the top of that test file.

**A tree match is not a live translation.** `findKeyInTree` answers "does this text
appear in the source", so a match can come from somewhere else: the entry for the board's
"Merge" column is kept because the Merge button also says "Merge". That is the direction
to fail in, since a false `gone` deletes a working translation while a false `rendered`
leaves an inert entry. Read `rendered` as "nothing to do", not as "verified accurate".

## Translation rules

Follow these when adding entries, whether by hand or through a batch pass.

**Do not translate:**

- Product and brand names: Kangentic, Claude, Claude Code, GitHub, GitLab, Jira,
  Asana, Azure DevOps, Sentry.
- Technical identifiers: file paths, command names, CLI flags, code identifiers,
  shell names, model ids.
- Keyboard notation: `Mod+Shift+P`, `Ctrl+C`, `Alt+F4`.
- Units that are already standard in Chinese engineering use: `Token`, `MB`, `GB`,
  `PR`, `JSON`, `URL`, `HTTP`, `MCP`, `CLI`, `CPU`.

**Terminology.** Pick one rendering and reuse it everywhere. This is the list
already in the dictionary; extend it rather than inventing a synonym.

| English | Chinese |
|---|---|
| Agent | 智能体 |
| Subagent | 子智能体 |
| Session | 会话 |
| Task | 任务 |
| Board | 看板 |
| Column | 列 |
| Swimlane | 泳道 |
| Backlog | 待办列表 |
| Card | 卡片 |
| Worktree | 工作树 |
| Branch | 分支 |
| Commit | 提交 |
| Diff | 差异 |
| Terminal | 终端 |
| Browser | 浏览器 |
| Monitor | 监控 |
| Stats | 统计 |
| Automation | 自动化 |
| Announcement | 公告 |
| Dictation | 语音输入 |
| Hotkeys | 快捷键 |
| Notifications | 通知 |
| Permission | 权限 |
| Model | 模型 |
| Effort | 推理强度 |
| Context window | 上下文窗口 |
| Profile (board profile) | 方案 |
| Override | 覆盖 |
| Relay | 中继 |
| Pairing | 配对 |
| Repository | 仓库 |

**Punctuation.** Chinese sentences take full-width punctuation (`，。？！：、`).
Use full-width parentheses `（）` in Chinese text. Do not put a space before a
full-width punctuation mark. Keep the app's trailing ellipsis as `...`.

**Never use an em-dash or an en-dash.** The repository bans them, and the
writing-style test scans `src/`. Use a comma, a period, or a single hyphen.

**Placeholders.** `{0}` must appear in the value exactly as many times as it
appears in the key, and in a position where the Chinese sentence reads naturally.
Do not renumber them.

**Length.** These strings live in toolbars, badges, and table cells. Prefer the
short form that still reads clearly over the complete sentence.

## After an upstream sync

```bash
git merge upstream/main
npm run i18n:report
```

The report prints three lists, because "the scan did not find it" and "nothing renders
it" are different answers.

- **Untranslated** (`i18n-work/untranslated.json`): the tree has copy the dictionary does
  not carry. Add it to `src/shared/i18n/locales/zh-CN.ts`, or run a batch pass.
- **Not copy** (`i18n-work/not-copy.json`): candidates that are not UI text, each with the
  reason it was rejected. Nothing to do here. Roughly a tenth of what the scan offers is a
  Tailwind class list, a URL, a file path, a host and port, an environment variable, an
  identifier, a product name, a dev-overlay legend entry, SVG path data, a font stack, a
  developer error, or a main-process log line. `notCopyReason` in `scripts/i18n-lib.mjs`
  scores one rule per shape and those reason strings are the rule list; `splitUntranslated`
  applies it. The percentage and `--max-untranslated` are measured against the copy that is
  left, so the denominator is a number that can reach zero.
- **Stale** (`i18n-work/stale.json`): the dictionary carries an entry the scan could not
  find in the tree. Upstream reworded or deleted that string, so the entry may no longer
  match and the screen may have reverted to English.

A stale entry is classified before it counts as work. `findKeyInTree` re-reads the tree for
each stale key, because the scan leaves two rendered shapes alone by design: a one or two
word label it rejects as too short to be prose (`Save changes`, `Loading...`), and a
sentence composed inside a conditional whose branches mix a literal with a template. Both
are live, so without the re-check a live entry and a dead one look identical.

| Status | Meaning | What to do |
|---|---|---|
| `rendered` | The tree carries the string, in the key's own spelling. | Nothing. The entry matches at runtime. |
| `recased` | The tree spells it differently, and the lookup is exact, so the entry is inert. | Re-key it to the tree's spelling, or delete it when that spelling is already translated. |
| `gone` | Nothing in the tree renders the string. | Delete the entry. |

Only `recased` and `gone` are actionable, and only they count toward `--max-stale`. A `gone`
appears when upstream deletes a string, so an empty actionable list is the normal result:
the rest of the stale list is entries the tree still renders and the scan cannot collect.
`npm run i18n:report -- --max-stale 0` fails on the actionable ones alone, and
`npm run i18n:merge -- --prune-stale` deletes only `gone` for the same reason.

A pattern entry covering a string the app composes at runtime rather than writing
literally shows as stale and is safe to leave. If one ever reports `gone`, add it to
`RUNTIME_ONLY_KEYS` in `scripts/i18n-lib.mjs` instead: that list injects the key into the
candidate set, which is how "Unknown site" survives, since `popupWindowTitleForUrl`
returns it and the only `translate()` call wraps the result.

To work through a large batch, `npm run i18n:batches` splits the untranslated copy into
per-area files under the gitignored `i18n-work/`, which keeps one screen's terminology
together. Fill in each `batch-NN.out.json` as a flat English-to-Chinese object and
`npm run i18n:merge` folds it back in. An empty value, or one equal to its key, is dropped
rather than stored, so a string that should stay English leaves no entry behind.

## Verifying a change

```bash
npx vitest run tests/unit/i18n.test.ts
npm run typecheck
```

The unit test locks the lookup semantics (exact keys, patterns, lazy captures, the
anchored-beats-unanchored and most-specific-wins tie-breaks, the length guard), the
classifier that decides a candidate is copy rather than noise, and the dictionary's shape:
no empty or untranslated value, no key without a letter, sequential placeholders with the
same set in the key and in the value, no em-dash or en-dash, and a curly quote only where
the key already carries one. It ends on `findKeyInTree`, including a read of the live tree.
The one coverage it does assert is the seeded swimlane names, for the reason under "Known
limits".

To see the result, run the app, or open the web demo. Both boot the same renderer.
