/**
 * OpenSpec slash commands Kangentic injects or documents.
 *
 * Cursor's form uses a hyphen (`/opsx-explore`, `/opsx-archive`). Docs may
 * show the canonical `/opsx:explore` / `/opsx:archive`. Spawn prepends these
 * exact strings; do not write them into `description` or `auto_command`.
 */
export const OPENSPEC_EXPLORE_COMMAND = '/opsx-explore';

export const OPENSPEC_ARCHIVE_COMMAND = '/opsx-archive';

/**
 * Isolated-worktree propose lands where scan cannot see it until the change
 * is on the default branch. Prepended with `/opsx-explore` on a discuss
 * fresh spawn, never as a column automation and never in `description`.
 */
export const OPENSPEC_PROPOSE_DEFAULT_BRANCH_NOTE =
  'Commit any OpenSpec change you propose to the default branch. Scan only sees openspec/changes that are already committed there.';
