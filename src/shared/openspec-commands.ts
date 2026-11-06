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
 * A discuss card in Planning runs in the project folder. The proposal must
 * still be committed to the default branch before the scan can create a
 * change card. Prepended with `/opsx-explore` on a discuss fresh spawn,
 * never as a column automation and never in `description`.
 */
export const OPENSPEC_PROPOSE_DEFAULT_BRANCH_NOTE =
  'You are in the project folder. Write the proposal under openspec/changes/ and commit it to the default branch so the next scan can create a change card.';
