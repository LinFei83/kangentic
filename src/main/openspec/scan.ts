/**
 * Scan default-branch `openspec/changes/` and upsert change cards.
 *
 * Uncommitted workspace files do not count. Listing, proposal text, and
 * `tasks.md` checkbox counts all come from `git ls-tree` / `git show` of the
 * default branch. `ls-tree` is run with `core.quotepath=false` and leftover
 * C-quoted names are decoded, so a non-ASCII directory keeps its real name.
 * If Planning proposes in an isolated worktree, the agent must commit that
 * directory to the default branch. That belongs in the discussion card's
 * opening, not in a column automation.
 */
import { IPC } from '../../shared/ipc-channels';
import type { Project, Task, TaskCreateInput, TaskUpdateInput } from '../../shared/types';
import { isShuttingDown } from '../shutdown-state';
import { openSimpleGit } from '../git/simple-git-client';
import { getProjectRepos } from '../ipc/helpers/project-repos';
import { announceTaskBoardChange } from '../ipc/helpers/task-write-announce';
import { sendToRenderer } from '../ipc/send-to-renderer';
import { resolveDefaultBaseBranch } from '../ipc/handlers/git-stats-capture';
import type { IpcContext } from '../ipc/ipc-context';
import {
  evaluateChange,
  isOpenspecCliMissing,
  runOpenspecCli,
  type OpenspecCliRunner,
  type OpenspecNoteToken,
} from './evaluate-change';
import {
  GIT_LS_TREE_NO_QUOTE,
  gitQuotedPathAliases,
  parseGitNameOnlyOutput,
} from './git-quoted-path';

export const OPENSPEC_CHANGES_TREE = 'openspec/changes';
const ARCHIVE_DIR = 'archive';
const ARCHIVE_DATED_NAME = /^(\d{4}-\d{2}-\d{2})-(.+)$/;
const MISSING_TREE_SENTINEL = '__missing__';

export interface OpenspecGitOps {
  revParse(spec: string): Promise<string>;
  lsTreeDirs(spec: string): Promise<string[]>;
  show(spec: string): Promise<string>;
}

export interface OpenspecTaskStore {
  getByOpenspecChange(name: string): Task | undefined;
  create(input: TaskCreateInput): Task;
  update(input: TaskUpdateInput): Task;
}

export interface OpenspecSwimlaneStore {
  list(): Array<{ id: string; role: string | null }>;
}

export interface ScanOpenspecChangesInput {
  project: Project;
  defaultBranch: string;
  tasks: OpenspecTaskStore;
  swimlanes: OpenspecSwimlaneStore;
  git: OpenspecGitOps;
  lastTreeSha: string | null;
  evaluate: (changeName: string, archived: boolean, tasksMarkdown: string | null) => Promise<OpenspecNoteToken>;
}

export interface ScanOpenspecChangesResult {
  treeSha: string | null;
  skipped: boolean;
  created: string[];
  updated: string[];
}

export function createOpenspecGit(projectPath: string): OpenspecGitOps {
  const git = openSimpleGit(projectPath);
  return {
    async revParse(spec: string) {
      return (await git.raw(['rev-parse', spec])).trim();
    },
    async lsTreeDirs(spec: string) {
      const output = await git.raw([...GIT_LS_TREE_NO_QUOTE, 'ls-tree', '-d', '--name-only', spec]);
      return parseGitNameOnlyOutput(output);
    },
    async show(spec: string) {
      return git.raw(['show', spec]);
    },
  };
}

/** Directory names under `openspec/changes/`, skipping `archive/` and dots. */
export function activeChangeNames(directoryNames: string[]): string[] {
  return directoryNames.filter((name) => name !== ARCHIVE_DIR && !name.startsWith('.'));
}

/**
 * Change name stored in `openspec/changes/archive/YYYY-MM-DD-<name>/`.
 * A folder that is not dated is used as the name itself.
 */
export function archiveChangeName(directoryName: string): string {
  const match = ARCHIVE_DATED_NAME.exec(directoryName);
  return match ? match[2] : directoryName;
}

function findChangeCard(tasks: OpenspecTaskStore, name: string): Task | undefined {
  for (const key of gitQuotedPathAliases(name)) {
    const found = tasks.getByOpenspecChange(key);
    if (found) return found;
  }
  return undefined;
}

export function parseProposal(markdown: string, fallbackTitle: string): { title: string; description: string } {
  const headingMatch = /^#{1,6}\s+(.+?)\s*$/m.exec(markdown);
  const title = headingMatch?.[1]?.trim() || fallbackTitle;
  let rest = markdown;
  if (headingMatch && headingMatch.index !== undefined) {
    rest = markdown.slice(headingMatch.index + headingMatch[0].length);
  }
  const nextHeading = rest.search(/\n#{1,6}\s+/);
  const summaryBlock = (nextHeading >= 0 ? rest.slice(0, nextHeading) : rest).trim();
  const paragraph = summaryBlock.split(/\n\s*\n/)[0]?.trim() ?? '';
  return { title, description: paragraph };
}

function isMissingTreeError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /does not exist/i.test(text)
    || /exists on disk, but not in/i.test(text)
    || /Not a valid object name/i.test(text)
    || /pathspec .* did not match/i.test(text);
}

async function readTreeSha(git: OpenspecGitOps, spec: string): Promise<string | null> {
  try {
    const sha = await git.revParse(spec);
    return sha.length > 0 ? sha : null;
  } catch (error: unknown) {
    if (isMissingTreeError(error)) return null;
    throw error;
  }
}

async function readDirs(git: OpenspecGitOps, spec: string): Promise<string[]> {
  try {
    return await git.lsTreeDirs(spec);
  } catch (error: unknown) {
    if (isMissingTreeError(error)) return [];
    throw error;
  }
}

async function readFile(git: OpenspecGitOps, spec: string): Promise<string | null> {
  try {
    return await git.show(spec);
  } catch (error: unknown) {
    if (isMissingTreeError(error) || /does not exist/i.test(error instanceof Error ? error.message : String(error))) {
      return null;
    }
    throw error;
  }
}

/**
 * One scan of default-branch `openspec/changes/`. Returns immediately when
 * the tree SHA matches `lastTreeSha`. Existing change cards only get a note
 * write when the token actually changed. A card stored under git's C-quoted
 * directory name is rewritten in place to the real name, so a previous
 * garbled scan does not create a second card. Regular and discussion cards
 * are left alone. Archive stamps `archived` and does not move the card to Done.
 */
export async function scanOpenspecChanges(input: ScanOpenspecChangesInput): Promise<ScanOpenspecChangesResult> {
  const treeSpec = `${input.defaultBranch}:${OPENSPEC_CHANGES_TREE}`;
  const treeSha = await readTreeSha(input.git, treeSpec);
  const comparableSha = treeSha ?? MISSING_TREE_SENTINEL;
  if (input.lastTreeSha !== null && comparableSha === input.lastTreeSha) {
    return { treeSha: comparableSha, skipped: true, created: [], updated: [] };
  }

  const created: string[] = [];
  const updated: string[] = [];

  if (treeSha === null) {
    return { treeSha: comparableSha, skipped: false, created, updated };
  }

  const children = await readDirs(input.git, treeSpec);
  const activeNames = activeChangeNames(children);
  const archivedChildren = children.includes(ARCHIVE_DIR)
    ? await readDirs(input.git, `${treeSpec}/${ARCHIVE_DIR}`)
    : [];
  const archivedNames = new Set(archivedChildren.map(archiveChangeName));

  const todoLane = input.swimlanes.list().find((lane) => lane.role === 'todo');

  for (const name of activeNames) {
    const note = await input.evaluate(name, false, await readFile(input.git, `${treeSpec}/${name}/tasks.md`));
    const existing = findChangeCard(input.tasks, name);
    if (!existing) {
      if (!todoLane) continue;
      const proposal = await readFile(input.git, `${treeSpec}/${name}/proposal.md`);
      const parsed = parseProposal(proposal ?? '', name);
      const createdTask = input.tasks.create({
        title: parsed.title,
        description: parsed.description,
        swimlane_id: todoLane.id,
        card_kind: 'change',
        openspec_change: name,
        openspec_note: note,
        externalSource: 'openspec',
        externalId: name,
      });
      created.push(createdTask.id);
      continue;
    }
    if (existing.card_kind !== 'change') continue;
    const patch: TaskUpdateInput = { id: existing.id };
    if (existing.openspec_change !== name) {
      patch.openspec_change = name;
      const shouldRefreshTitle = existing.title === existing.openspec_change;
      const shouldRefreshDescription = !existing.description;
      if (shouldRefreshTitle || shouldRefreshDescription) {
        const proposal = await readFile(input.git, `${treeSpec}/${name}/proposal.md`);
        const parsed = parseProposal(proposal ?? '', name);
        if (shouldRefreshTitle) patch.title = parsed.title;
        if (shouldRefreshDescription) patch.description = parsed.description;
      }
    }
    if (existing.openspec_note !== note) patch.openspec_note = note;
    if (patch.openspec_change === undefined && patch.openspec_note === undefined) continue;
    const updatedTask = input.tasks.update(patch);
    updated.push(updatedTask.id);
  }

  for (const archivedName of archivedNames) {
    if (activeNames.includes(archivedName)) continue;
    const existing = findChangeCard(input.tasks, archivedName);
    if (!existing || existing.card_kind !== 'change') continue;
    const patch: TaskUpdateInput = { id: existing.id, openspec_note: 'archived' };
    if (existing.openspec_change !== archivedName) patch.openspec_change = archivedName;
    if (existing.openspec_note === 'archived' && patch.openspec_change === undefined) continue;
    const updatedTask = input.tasks.update(patch);
    updated.push(updatedTask.id);
  }

  return { treeSha: comparableSha, skipped: false, created, updated };
}

function createCliRunner(projectPath: string): OpenspecCliRunner | null {
  let missing = false;
  return async (args) => {
    if (missing) {
      const error = Object.assign(new Error('OpenSpec CLI was not found'), { code: 'ENOENT' });
      throw error;
    }
    try {
      return await runOpenspecCli(args, projectPath);
    } catch (error: unknown) {
      if (isOpenspecCliMissing(error)) missing = true;
      throw error;
    }
  };
}

/**
 * Production scan: git + CLI against `project.path`, writes through the
 * project's task repository, reloads the board through existing pushes.
 */
export async function scanOpenspecChangesForProject(
  context: IpcContext,
  project: Project,
  lastTreeSha: string | null,
): Promise<ScanOpenspecChangesResult> {
  if (isShuttingDown()) {
    return { treeSha: lastTreeSha, skipped: true, created: [], updated: [] };
  }
  const { tasks, swimlanes } = getProjectRepos(context, project.id);
  const git = createOpenspecGit(project.path);
  const runCli = createCliRunner(project.path);
  const result = await scanOpenspecChanges({
    project,
    defaultBranch: resolveDefaultBaseBranch(context, project.path),
    tasks,
    swimlanes,
    git,
    lastTreeSha,
    evaluate: (changeName, archived, tasksMarkdown) => evaluateChange({
      archived,
      tasksMarkdown,
      runCli,
      changeName,
    }),
  });
  notifyBoard(context, project.id, result);
  return result;
}

function notifyBoard(context: IpcContext, projectId: string, result: ScanOpenspecChangesResult): void {
  const ids = [...result.created, ...result.updated];
  if (ids.length === 0) return;
  if (isShuttingDown()) return;
  announceTaskBoardChange(context, projectId, {
    change: result.created.length > 0 ? 'task-created' : 'task-updated',
    ids,
  });
  // Quiet reload. TASK_CREATED_BY_AGENT would toast "Task created by agent".
  sendToRenderer(context.mainWindow, IPC.TASK_CHANGED_IN_OTHER_WINDOW, projectId);
}
