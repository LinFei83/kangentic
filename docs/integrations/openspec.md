---
type: Reference
title: OpenSpec board cards
description: How Kangentic scans default-branch committed openspec/changes into change cards, evaluates notes with the OpenSpec CLI, watches git HEAD rather than the working tree, fills {{openspec_xml}} at spawn, and archives without moving the card to Done.
tags: [openspec, change-cards, scan, automations]
sources:
  - resource: src/main/openspec/
  - resource: src/shared/openspec-notes.ts
  - resource: src/shared/openspec-commands.ts
---
# OpenSpec board cards

Kangentic treats an OpenSpec change as a board card. The scan reads
`openspec/changes/` on the **default branch** only. Uncommitted workspace files
do not count, and neither does a proposal that still lives only in an isolated
worktree. A discuss card in a planning column skips the worktree and runs in
the project folder, so the proposal is written where a commit to the default
branch can make the next scan see it. A discuss card's fresh spawn says so
after `/opsx-explore`. It is not a column automation and it is not stored in
`description`. Work cards and change cards still get a worktree in Planning.

Kangentic does not ship the OpenSpec CLI. When the binary is missing, the scan
still creates the card and stamps `openspec_note` `missing`. Cards are not
blocked from moving in this first version: a drag is not refused for a note.

## Scan

`scan-scheduler.ts` runs one scan per focused project. Opening a project scans
once, then `head-watcher.ts` watches `.git/HEAD`, `packed-refs`, and
`logs/HEAD`. It does not watch the working tree or the index, so a local save
does not create a card.

Each scan starts with `git rev-parse <defaultBranch>:openspec/changes`. An
unchanged tree SHA returns without listing. `ls-tree` runs with
`core.quotepath=false`, and a leftover C-quoted name (octal bytes in quotes)
is decoded before it becomes `openspec_change` or is passed to
`openspec validate`, so a non-ASCII directory keeps its real name. For each
directory under `openspec/changes/` (except `archive/` and names that start
with a dot) it upserts a task with `card_kind` `change`,
`external_source` `openspec`, and `openspec_change` equal to the directory
name. New cards land in To Do. The card title is the directory name. The
description is the paragraph under `## Why` in `proposal.md`, or the first
prose paragraph when that section is missing. A card already stored under
git's C-quoted directory name is rewritten in place to the real name,
including its title when the title was that quoted string. A leftover title
that is itself a section heading is rewritten to the directory name. If a
real-name card already exists, the leftover quoted row is left alone.
Regular and discuss cards are left alone.

`evaluate-change.ts` maps CLI validate plus `tasks.md` checkbox counts onto a
stable `openspec_note` token (`ready`, `tasks:3/12`, `archived`, `invalid`,
`missing`, `error`). The note is never a sentence.

## Archive

A directory that has moved to `openspec/changes/archive/` stamps the existing
card `archived`. A leftover quoted `openspec_change` is rewritten to the real
name first, including the title when it still equals that quoted string or
is a section heading. Archive does **not** move the card to Done. Board Done still means the PR
merged. This board's Merge change list sends `/opsx-archive` after
`PR: merged`, then moves to Done on `OpenSpec: archived`. Regular Merge still
goes to Done on `PR: merged`.

## `{{openspec_xml}}`

Spawn pre-loads the change from the default branch (`git show` of
`proposal.md`, `specs/`, and `tasks.md`) onto the template context. Regular
cards resolve empty and drop-and-collapse removes the keyword. Column
automations do not load git: they stay empty. The default prompt template does
not include the keyword yet.

## Automations

Each column has two lists. Regular runs for work and discuss cards. Change
runs for OpenSpec change cards. Empty Change means nothing auto-runs for those
cards in that column. To Do and Planning keep Change empty on this board.
Executing, Code Review, Testing, and Merge copy the regular lists onto Change,
with Merge inserting archive before Done as above. A Board Profile does not
overlay automations.

A change card leaving To Do does not send its description as the opening
prompt. That text is the Why paragraph the scan copied from `proposal.md`, and
it is the wrong first instruction. The destination column's On task enter
Send message to agent row, when it has one, opens the agent instead
(`/opsx-apply` on Executing). A regular work card still opens on
`{{task_xml}}{{workflow_xml}}{{attachments}}`. A discuss card still prepends
`/opsx-explore`.
