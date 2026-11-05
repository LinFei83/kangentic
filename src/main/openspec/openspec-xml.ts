/**
 * Spawn-time `{{openspec_xml}}` for an OpenSpec change card.
 *
 * Reads proposal.md, specs/, and tasks.md from the default branch via
 * `git show` / `ls-tree`. Uncommitted workspace files do not count, matching
 * the scan. Regular cards skip this and resolve empty so drop-and-collapse
 * removes the keyword. Resolvers stay sync: callers pre-load onto
 * `TaskTemplateContext.openspecXml` on the main-process spawn path.
 */
import type { Task } from '../../shared/types';
import { openSimpleGit } from '../git/simple-git-client';
import { escapeXml } from '../agent/shared/prompt-xml';
import { GIT_LS_TREE_NO_QUOTE, parseGitNameOnlyOutput } from './git-quoted-path';

const CHANGES_TREE = 'openspec/changes';

export interface OpenspecXmlGit {
  show(spec: string): Promise<string>;
  lsTreeFiles(spec: string): Promise<string[]>;
}

export interface OpenspecXmlInput {
  name: string;
  proposal: string | null;
  specs: Array<{ path: string; body: string }>;
  tasks: string | null;
}

export function createOpenspecXmlGit(projectPath: string): OpenspecXmlGit {
  const git = openSimpleGit(projectPath);
  return {
    async show(spec) {
      return git.raw(['show', spec]);
    },
    async lsTreeFiles(spec) {
      const output = await git.raw([...GIT_LS_TREE_NO_QUOTE, 'ls-tree', '-r', '--name-only', spec]);
      return parseGitNameOnlyOutput(output);
    },
  };
}

/**
 * Build the `<openspec>` envelope. Empty sections are omitted. Multi-line
 * bodies sit on their own lines, matching `buildTaskXml`.
 */
export function buildOpenspecXml(input: OpenspecXmlInput): string {
  const name = input.name.trim();
  if (!name) return '';
  const lines: string[] = ['<openspec>'];
  lines.push(`  <name>${escapeXml(name)}</name>`);
  const proposal = xmlChild('proposal', input.proposal);
  if (proposal) lines.push(proposal);
  for (const spec of input.specs) {
    const relativePath = spec.path.trim();
    if (!relativePath) continue;
    const body = xmlChild('spec', spec.body, `path="${escapeXml(relativePath)}"`);
    if (body) lines.push(body);
  }
  const tasks = xmlChild('tasks', input.tasks);
  if (tasks) lines.push(tasks);
  lines.push('</openspec>');
  return lines.join('\n');
}

export async function loadOpenspecXml(input: {
  git: OpenspecXmlGit;
  defaultBranch: string;
  changeName: string;
}): Promise<string> {
  const changeName = input.changeName.trim();
  const defaultBranch = input.defaultBranch.trim();
  if (!changeName || !defaultBranch) return '';
  const prefix = `${defaultBranch}:${CHANGES_TREE}/${changeName}`;
  const proposal = await readFile(input.git, `${prefix}/proposal.md`);
  const tasks = await readFile(input.git, `${prefix}/tasks.md`);
  const specPaths = await readTreeFiles(input.git, `${prefix}/specs`);
  const specs: Array<{ path: string; body: string }> = [];
  for (const relativePath of [...specPaths].sort()) {
    const body = await readFile(input.git, `${prefix}/specs/${relativePath}`);
    if (body && body.trim()) specs.push({ path: relativePath, body });
  }
  return buildOpenspecXml({ name: changeName, proposal, specs, tasks });
}

/**
 * Pre-resolve `{{openspec_xml}}` for a spawn. Regular cards and missing git
 * inputs return '' without touching git. A git error also returns '', so a
 * missing tree cannot fail the spawn.
 */
export async function loadOpenspecXmlForTask(input: {
  task: Pick<Task, 'card_kind' | 'openspec_change'>;
  projectPath: string | null;
  defaultBranch: string;
  git?: OpenspecXmlGit;
}): Promise<string> {
  if (input.task.card_kind !== 'change') return '';
  const changeName = input.task.openspec_change?.trim() ?? '';
  const projectPath = input.projectPath?.trim() ?? '';
  const defaultBranch = input.defaultBranch.trim();
  if (!changeName || !projectPath || !defaultBranch) return '';
  try {
    const git = input.git ?? createOpenspecXmlGit(projectPath);
    return await loadOpenspecXml({ git, defaultBranch, changeName });
  } catch {
    return '';
  }
}

function xmlChild(tag: string, value: string | null | undefined, attributes?: string): string | null {
  if (value == null) return null;
  const body = value.replace(/\s+$/, '');
  if (!body) return null;
  const open = attributes ? `<${tag} ${attributes}>` : `<${tag}>`;
  if (body.includes('\n')) {
    return `  ${open}\n${escapeXml(body)}\n  </${tag}>`;
  }
  return `  ${open}${escapeXml(body)}</${tag}>`;
}

async function readFile(git: OpenspecXmlGit, spec: string): Promise<string | null> {
  try {
    return await git.show(spec);
  } catch (error: unknown) {
    if (isMissingTreeError(error)) return null;
    throw error;
  }
}

async function readTreeFiles(git: OpenspecXmlGit, spec: string): Promise<string[]> {
  try {
    return await git.lsTreeFiles(spec);
  } catch (error: unknown) {
    if (isMissingTreeError(error)) return [];
    throw error;
  }
}

function isMissingTreeError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /does not exist/i.test(text)
    || /exists on disk, but not in/i.test(text)
    || /Not a valid object name/i.test(text)
    || /pathspec .* did not match/i.test(text);
}
