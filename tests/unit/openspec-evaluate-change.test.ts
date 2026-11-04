/**
 * OpenSpec note evaluation: checkbox parse, token table, missing CLI, and
 * validate JSON mapping. The scan writes these tokens; the UI paints them.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  evaluateChange,
  isOpenspecCliMissing,
  noteFromEvaluation,
  parseTasksCheckboxes,
  parseValidateResult,
  type OpenspecCliRunner,
} from '../../src/main/openspec/evaluate-change';

describe('parseTasksCheckboxes', () => {
  it('counts done and open boxes, treating X as done', () => {
    const markdown = [
      '# Tasks',
      '- [x] one',
      '- [X] two',
      '- [ ] three',
      '- [ ] four',
      '',
      'Not a box: [x]',
      '* [x] star lists are not counted',
    ].join('\n');
    expect(parseTasksCheckboxes(markdown)).toEqual({ done: 2, total: 4 });
  });

  it('returns null when the file has no task boxes', () => {
    expect(parseTasksCheckboxes('# Tasks\n\nNo boxes yet.\n')).toBeNull();
    expect(parseTasksCheckboxes('')).toBeNull();
  });

  it('counts indented boxes', () => {
    expect(parseTasksCheckboxes('  - [x] nested\n  - [ ] still open\n')).toEqual({
      done: 1,
      total: 2,
    });
  });
});

describe('noteFromEvaluation', () => {
  it('stamps archived without needing the CLI', () => {
    expect(noteFromEvaluation({
      archived: true,
      cliMissing: true,
      validate: 'error',
      tasks: { done: 3, total: 12 },
    })).toBe('archived');
  });

  it('stamps missing when a CLI call was needed and the binary is gone', () => {
    expect(noteFromEvaluation({
      archived: false,
      cliMissing: true,
      validate: null,
      tasks: { done: 1, total: 4 },
    })).toBe('missing');
  });

  it('stamps invalid, error, ready, and tasks:n/n from validate plus counts', () => {
    expect(noteFromEvaluation({
      archived: false,
      cliMissing: false,
      validate: 'failed',
      tasks: { done: 0, total: 4 },
    })).toBe('invalid');
    expect(noteFromEvaluation({
      archived: false,
      cliMissing: false,
      validate: 'error',
      tasks: null,
    })).toBe('error');
    expect(noteFromEvaluation({
      archived: false,
      cliMissing: false,
      validate: null,
      tasks: null,
    })).toBe('error');
    expect(noteFromEvaluation({
      archived: false,
      cliMissing: false,
      validate: 'passed',
      tasks: null,
    })).toBe('ready');
    expect(noteFromEvaluation({
      archived: false,
      cliMissing: false,
      validate: 'passed',
      tasks: { done: 0, total: 12 },
    })).toBe('ready');
    expect(noteFromEvaluation({
      archived: false,
      cliMissing: false,
      validate: 'passed',
      tasks: { done: 3, total: 12 },
    })).toBe('tasks:3/12');
    expect(noteFromEvaluation({
      archived: false,
      cliMissing: false,
      validate: 'passed',
      tasks: { done: 12, total: 12 },
    })).toBe('tasks:12/12');
  });
});

describe('isOpenspecCliMissing', () => {
  it('recognizes ENOENT, 127, and Windows/POSIX not-found text', () => {
    expect(isOpenspecCliMissing({ code: 'ENOENT' })).toBe(true);
    expect(isOpenspecCliMissing({ code: 127 })).toBe(true);
    expect(isOpenspecCliMissing({ message: "'openspec' is not recognized as an internal or external command" })).toBe(true);
    expect(isOpenspecCliMissing({ stderr: 'openspec: command not found' })).toBe(true);
    expect(isOpenspecCliMissing({ code: 1, message: 'validation failed' })).toBe(false);
  });
});

describe('parseValidateResult', () => {
  it('reads valid true/false from JSON and falls back to the exit code', () => {
    expect(parseValidateResult({ stdout: '{"valid":true}', stderr: '', exitCode: 0 })).toBe('passed');
    expect(parseValidateResult({ stdout: '{"valid":false}', stderr: '', exitCode: 1 })).toBe('failed');
    expect(parseValidateResult({ stdout: '{"success":false}', stderr: '', exitCode: 2 })).toBe('failed');
    expect(parseValidateResult({ stdout: '', stderr: '', exitCode: 0 })).toBe('passed');
    expect(parseValidateResult({ stdout: 'not json', stderr: '', exitCode: 1 })).toBe('error');
  });
});

describe('evaluateChange', () => {
  it('does not call the CLI for an archived change', async () => {
    const runCli = vi.fn() as unknown as OpenspecCliRunner;
    await expect(evaluateChange({
      archived: true,
      tasksMarkdown: '- [x] leftover',
      runCli,
      changeName: 'add-rate-limiting',
    })).resolves.toBe('archived');
    expect(runCli).not.toHaveBeenCalled();
  });

  it('stamps missing without calling validate when the runner is null', async () => {
    await expect(evaluateChange({
      archived: false,
      tasksMarkdown: '- [ ] one',
      runCli: null,
      changeName: 'add-rate-limiting',
    })).resolves.toBe('missing');
  });

  it('stamps missing when validate throws a not-found error', async () => {
    const runCli = vi.fn(async () => {
      throw Object.assign(new Error('spawn openspec ENOENT'), { code: 'ENOENT' });
    });
    await expect(evaluateChange({
      archived: false,
      tasksMarkdown: null,
      runCli,
      changeName: 'add-rate-limiting',
    })).resolves.toBe('missing');
  });

  it('calls validate then status, and stamps tasks progress when validate passed', async () => {
    const runCli = vi.fn(async (args: string[]) => {
      if (args[0] === 'validate') return { stdout: '{"valid":true}', stderr: '', exitCode: 0 };
      return { stdout: '{}', stderr: '', exitCode: 0 };
    });
    await expect(evaluateChange({
      archived: false,
      tasksMarkdown: '- [x] one\n- [ ] two\n- [ ] three\n',
      runCli,
      changeName: 'add-rate-limiting',
    })).resolves.toBe('tasks:1/3');
    expect(runCli.mock.calls[0][0]).toEqual([
      'validate', 'add-rate-limiting', '--type', 'change', '--json', '--no-interactive',
    ]);
    expect(runCli.mock.calls[1][0]).toEqual(['status', '--change', 'add-rate-limiting', '--json']);
  });
});
