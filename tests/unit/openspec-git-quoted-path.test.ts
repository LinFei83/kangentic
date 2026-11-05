/**
 * Git C-quoted `ls-tree --name-only` names. Default `core.quotepath` turns a
 * Chinese change directory into octal escapes; the scan used that string as
 * the OpenSpec name, validate failed, and the card title was garbled.
 *
 * Decoder cases are fixtures (the quoted form git actually prints). The
 * createOpenspecGit / createOpenspecXmlGit cases run real git in a temp repo
 * with a Chinese change directory.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  decodeGitQuotedPath,
  encodeGitQuotedPath,
  gitQuotedPathAliases,
  parseGitNameOnlyOutput,
} from '../../src/main/openspec/git-quoted-path';
import { createOpenspecGit } from '../../src/main/openspec/scan';
import { createOpenspecXmlGit } from '../../src/main/openspec/openspec-xml';

const CHANGE_NAME = '创建测试变更';
// git -c core.quotepath=true ls-tree --name-only of CHANGE_NAME.
const QUOTED_CHANGE_NAME = '"\\345\\210\\233\\345\\273\\272\\346\\265\\213\\350\\257\\225\\345\\217\\230\\346\\233\\264"';

describe('decodeGitQuotedPath / parseGitNameOnlyOutput', () => {
  it('decodes the octal C-quote git prints for a Chinese change directory', () => {
    expect(decodeGitQuotedPath(QUOTED_CHANGE_NAME)).toBe(CHANGE_NAME);
  });

  it('leaves an unquoted ASCII name alone', () => {
    expect(decodeGitQuotedPath('add-rate-limiting')).toBe('add-rate-limiting');
  });

  it('unescapes C quotes, backslashes, and newlines inside a quoted name', () => {
    expect(decodeGitQuotedPath('"foo\\"bar"')).toBe('foo"bar');
    expect(decodeGitQuotedPath('"foo\\\\bar"')).toBe('foo\\bar');
    expect(decodeGitQuotedPath('"foo\\nbar"')).toBe('foo\nbar');
  });

  it('decodes a quoted archive folder that mixes ASCII and octal', () => {
    expect(decodeGitQuotedPath(`"2026-11-04-${QUOTED_CHANGE_NAME.slice(1, -1)}"`)).toBe(
      `2026-11-04-${CHANGE_NAME}`,
    );
  });

  it('splits ls-tree stdout and decodes only the quoted lines', () => {
    expect(parseGitNameOnlyOutput(`${QUOTED_CHANGE_NAME}\narchive\nadd-rate-limiting\n`)).toEqual([
      CHANGE_NAME,
      'archive',
      'add-rate-limiting',
    ]);
  });

  it('encodes a Chinese directory the way default git quotepath prints it', () => {
    expect(encodeGitQuotedPath(CHANGE_NAME)).toBe(QUOTED_CHANGE_NAME);
    expect(encodeGitQuotedPath('add-rate-limiting')).toBe('add-rate-limiting');
    expect(decodeGitQuotedPath(encodeGitQuotedPath(CHANGE_NAME))).toBe(CHANGE_NAME);
  });

  it('looks up the real name before the quoted leftover', () => {
    expect(gitQuotedPathAliases(CHANGE_NAME)).toEqual([CHANGE_NAME, QUOTED_CHANGE_NAME]);
    expect(gitQuotedPathAliases('add-rate-limiting')).toEqual(['add-rate-limiting']);
  });
});

describe('createOpenspecGit / createOpenspecXmlGit against real git', () => {
  let repository: string;

  beforeEach(() => {
    repository = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kangentic-openspec-quote-')));
    runGit(repository, ['init', '-b', 'main']);
    runGit(repository, ['config', 'user.email', 'dev@example.com']);
    runGit(repository, ['config', 'user.name', 'Dev']);
    const changeDirectory = path.join(repository, 'openspec', 'changes', CHANGE_NAME);
    fs.mkdirSync(path.join(changeDirectory, 'specs'), { recursive: true });
    fs.writeFileSync(path.join(changeDirectory, 'proposal.md'), `# ${CHANGE_NAME}\n\nShip it.\n`);
    fs.writeFileSync(path.join(changeDirectory, 'tasks.md'), '- [ ] one\n');
    fs.writeFileSync(path.join(changeDirectory, 'specs', '说明.md'), 'Users sign in.\n');
    runGit(repository, ['add', '-A']);
    runGit(repository, ['commit', '-m', 'add chinese change']);
  });

  afterEach(async () => {
    await fs.promises.rm(repository, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it('lists the real Chinese directory, not the octal C-quote default git prints', async () => {
    const defaultQuoted = runGit(repository, [
      '-c',
      'core.quotepath=true',
      'ls-tree',
      '-d',
      '--name-only',
      'main:openspec/changes',
    ]);
    expect(defaultQuoted.trim()).toBe(QUOTED_CHANGE_NAME);

    const directories = await createOpenspecGit(repository).lsTreeDirs('main:openspec/changes');
    expect(directories).toEqual([CHANGE_NAME]);

    const proposal = await createOpenspecGit(repository).show(
      `main:openspec/changes/${CHANGE_NAME}/proposal.md`,
    );
    expect(proposal).toContain(`# ${CHANGE_NAME}`);
  });

  it('lists a Chinese spec file under that change by its real name', async () => {
    const files = await createOpenspecXmlGit(repository).lsTreeFiles(
      `main:openspec/changes/${CHANGE_NAME}/specs`,
    );
    expect(files).toEqual(['说明.md']);
  });
});

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8' });
}
