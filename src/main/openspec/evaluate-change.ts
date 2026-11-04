/**
 * OpenSpec change-card note evaluation. The scan stores only the stable tokens
 * in `src/shared/openspec-notes.ts`. Validators stay the OpenSpec CLI; this
 * module maps their result plus `tasks.md` checkbox counts onto those tokens.
 *
 * Checkbox counts come from default-branch `git show` of `tasks.md`, not the
 * working tree. Validate still runs the CLI against the project checkout,
 * because the CLI has no "read this tree-ish" mode. Uncommitted files never
 * create cards (listing is `git ls-tree` on the default branch). If Planning
 * proposes in an isolated worktree, the agent must commit that directory to
 * the default branch. That is a comment for the discussion card, not an
 * automation.
 */
import { execAsync, execFileAsync } from '../utility-process/off-main-exec';
import { childProcessEnv } from '../shared/child-env';
import { quoteArg } from '../../shared/paths';
import { quoteCmdExecutable } from '../../shared/shell-quote';

const CLI_TIMEOUT_MS = 20_000;
const TASK_CHECKBOX = /^\s*-\s\[([ xX])\]/;

/** Tokens the scan writes to `Task.openspec_note`. */
export type OpenspecNoteToken =
  | 'ready'
  | 'archived'
  | 'invalid'
  | 'missing'
  | 'error'
  | `tasks:${number}/${number}`;

export interface TasksCheckboxCount {
  done: number;
  total: number;
}

/**
 * Count OpenSpec `tasks.md` checkboxes. `- [x]` / `- [X]` are done, `- [ ]`
 * is open. Returns null when the file has none, so the caller can stamp
 * `ready` ("not counted") instead of `tasks:0/0`.
 */
export function parseTasksCheckboxes(markdown: string): TasksCheckboxCount | null {
  let done = 0;
  let total = 0;
  for (const line of markdown.split(/\r?\n/)) {
    const match = TASK_CHECKBOX.exec(line);
    if (!match) continue;
    total += 1;
    if (match[1] !== ' ') done += 1;
  }
  if (total === 0) return null;
  return { done, total };
}

/**
 * Map evaluation inputs onto one stored token. Archived wins: the directory
 * is on the default branch under `openspec/changes/archive/`, so the CLI is
 * not needed. Missing wins over checkbox counts when a CLI call was required.
 */
export function noteFromEvaluation(input: {
  archived: boolean;
  cliMissing: boolean;
  validate: 'passed' | 'failed' | 'error' | null;
  tasks: TasksCheckboxCount | null;
}): OpenspecNoteToken {
  if (input.archived) return 'archived';
  if (input.cliMissing) return 'missing';
  if (input.validate === 'error' || input.validate === null) return 'error';
  if (input.validate === 'failed') return 'invalid';
  // Validate passed. Tasks not started, or the file had nothing to count.
  if (input.tasks === null || input.tasks.done === 0) return 'ready';
  return `tasks:${input.tasks.done}/${input.tasks.total}`;
}

/** True when a CLI spawn never reached the OpenSpec binary. */
export function isOpenspecCliMissing(error: unknown): boolean {
  if (error == null) return false;
  const record = error as { code?: unknown; message?: unknown; stderr?: unknown; stdout?: unknown };
  if (record.code === 'ENOENT' || record.code === 127) return true;
  const text = [record.message, record.stderr, record.stdout]
    .filter((part): part is string => typeof part === 'string')
    .join('\n');
  if (/not recognized as an internal or external command/i.test(text)) return true;
  if (/command not found/i.test(text)) return true;
  if (/\bENOENT\b/.test(text)) return true;
  return false;
}

export interface OpenspecCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type OpenspecCliRunner = (args: string[]) => Promise<OpenspecCliResult>;

/**
 * Run the OpenSpec CLI in `cwd`. Windows goes through `execAsync` so an npm
 * `.cmd` shim is reachable; POSIX uses `execFile`. The installer does not
 * ship this binary.
 */
export async function runOpenspecCli(
  args: string[],
  cwd: string,
  cliPath = 'openspec',
): Promise<OpenspecCliResult> {
  const options = {
    cwd,
    timeout: CLI_TIMEOUT_MS,
    windowsHide: true,
    env: childProcessEnv(),
  };
  try {
    if (process.platform === 'win32') {
      const command = `${quoteCmdExecutable(cliPath)} ${args.map((arg) => quoteArg(arg, 'cmd.exe')).join(' ')}`;
      const output = await execAsync(command, options);
      return { stdout: output.stdout, stderr: output.stderr, exitCode: 0 };
    }
    const output = await execFileAsync(cliPath, args, options);
    return { stdout: output.stdout, stderr: output.stderr, exitCode: 0 };
  } catch (error: unknown) {
    if (isOpenspecCliMissing(error)) throw error;
    const record = error as { stdout?: unknown; stderr?: unknown; code?: unknown };
    const stdout = typeof record.stdout === 'string' ? record.stdout : '';
    const stderr = typeof record.stderr === 'string' ? record.stderr : '';
    const exitCode = typeof record.code === 'number' ? record.code : 1;
    return { stdout, stderr, exitCode };
  }
}

/** Parse `openspec validate --json` (or a non-zero exit) into pass/fail/error. */
export function parseValidateResult(result: OpenspecCliResult): 'passed' | 'failed' | 'error' {
  const payload = parseFirstJsonObject(`${result.stdout}\n${result.stderr}`);
  if (payload) {
    if (payload.valid === false || payload.success === false || payload.ok === false) return 'failed';
    if (payload.valid === true || payload.success === true || payload.ok === true) return 'passed';
    if (Array.isArray(payload.errors) && payload.errors.length > 0) return 'failed';
  }
  if (result.exitCode === 0) return 'passed';
  if (payload) return 'failed';
  return 'error';
}

function parseFirstJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface EvaluateChangeInput {
  archived: boolean;
  tasksMarkdown: string | null;
  /** Null when the binary was not found. Skip CLI and stamp `missing`. */
  runCli: OpenspecCliRunner | null;
  changeName: string;
}

/**
 * Stamp one change. Calls `openspec validate` and `openspec status` as the
 * plan names them; the token comes from validate plus checkbox counts.
 */
export async function evaluateChange(input: EvaluateChangeInput): Promise<OpenspecNoteToken> {
  if (input.archived) {
    return noteFromEvaluation({
      archived: true,
      cliMissing: false,
      validate: null,
      tasks: null,
    });
  }

  if (!input.runCli) {
    return noteFromEvaluation({
      archived: false,
      cliMissing: true,
      validate: null,
      tasks: parseTasksMarkdown(input.tasksMarkdown),
    });
  }

  try {
    const validateResult = await input.runCli([
      'validate',
      input.changeName,
      '--type',
      'change',
      '--json',
      '--no-interactive',
    ]);
    // Status is the other CLI the plan names. Validate is the pass/fail
    // authority; a status failure after a passing validate does not override
    // checkbox counts from default-branch `tasks.md`.
    await input.runCli(['status', '--change', input.changeName, '--json']).catch((error: unknown) => {
      if (isOpenspecCliMissing(error)) throw error;
    });
    return noteFromEvaluation({
      archived: false,
      cliMissing: false,
      validate: parseValidateResult(validateResult),
      tasks: parseTasksMarkdown(input.tasksMarkdown),
    });
  } catch (error: unknown) {
    if (isOpenspecCliMissing(error)) {
      return noteFromEvaluation({
        archived: false,
        cliMissing: true,
        validate: null,
        tasks: parseTasksMarkdown(input.tasksMarkdown),
      });
    }
    return noteFromEvaluation({
      archived: false,
      cliMissing: false,
      validate: 'error',
      tasks: parseTasksMarkdown(input.tasksMarkdown),
    });
  }
}

function parseTasksMarkdown(markdown: string | null): TasksCheckboxCount | null {
  if (markdown == null || markdown.length === 0) return null;
  return parseTasksCheckboxes(markdown);
}
