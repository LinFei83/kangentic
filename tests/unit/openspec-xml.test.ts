/**
 * Spawn-time `{{openspec_xml}}`: envelope shape, omit-empty, git show of the
 * default branch, and the regular-card skip that keeps resolvers sync.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Task } from '../../src/shared/types';
import {
  buildOpenspecXml,
  loadOpenspecXml,
  loadOpenspecXmlForTask,
  type OpenspecXmlGit,
} from '../../src/main/openspec/openspec-xml';
import { resolveTaskTemplateVars } from '../../src/main/agent/shared/task-template-resolvers';

function makeGit(files: Record<string, string>): OpenspecXmlGit {
  return {
    async show(spec) {
      if (!(spec in files)) throw new Error(`path '${spec}' does not exist`);
      return files[spec];
    },
    async lsTreeFiles(spec) {
      const prefix = `${spec}/`;
      const names = Object.keys(files)
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
      if (names.length === 0 && !(spec in files)) {
        throw new Error(`path '${spec}' does not exist`);
      }
      return names;
    },
  };
}

describe('buildOpenspecXml', () => {
  it('wraps name, proposal, specs and tasks, omitting empty sections', () => {
    expect(buildOpenspecXml({
      name: 'add-login',
      proposal: 'Ship login.',
      specs: [{ path: 'auth.md', body: 'Users can sign in.' }],
      tasks: '- [ ] Add the form',
    })).toBe([
      '<openspec>',
      '  <name>add-login</name>',
      '  <proposal>Ship login.</proposal>',
      '  <spec path="auth.md">Users can sign in.</spec>',
      '  <tasks>- [ ] Add the form</tasks>',
      '</openspec>',
    ].join('\n'));
  });

  it('puts multi-line bodies on their own lines and escapes XML', () => {
    expect(buildOpenspecXml({
      name: 'a<b>',
      proposal: 'Line 1\nLine 2 & more',
      specs: [],
      tasks: null,
    })).toBe([
      '<openspec>',
      '  <name>a&lt;b&gt;</name>',
      '  <proposal>',
      'Line 1\nLine 2 &amp; more',
      '  </proposal>',
      '</openspec>',
    ].join('\n'));
  });

  it('returns empty when the change name is blank', () => {
    expect(buildOpenspecXml({ name: '  ', proposal: 'x', specs: [], tasks: null })).toBe('');
  });
});

describe('loadOpenspecXml', () => {
  it('reads proposal.md, specs/, and tasks.md from the default branch', async () => {
    const git = makeGit({
      'main:openspec/changes/add-login/proposal.md': '# Add login\n\nShip it.',
      'main:openspec/changes/add-login/tasks.md': '- [ ] Form',
      'main:openspec/changes/add-login/specs/auth.md': 'Users sign in.',
      'main:openspec/changes/add-login/specs/nested/session.md': 'Keep a session.',
    });

    const xml = await loadOpenspecXml({ git, defaultBranch: 'main', changeName: 'add-login' });
    expect(xml).toContain('<name>add-login</name>');
    expect(xml).toContain('<proposal>');
    expect(xml).toContain('Ship it.');
    expect(xml).toContain('<spec path="auth.md">Users sign in.</spec>');
    expect(xml).toContain('<spec path="nested/session.md">Keep a session.</spec>');
    expect(xml).toContain('<tasks>- [ ] Form</tasks>');
    expect(xml).not.toContain('design.md');
  });

  it('omits missing files instead of failing', async () => {
    const git = makeGit({});
    const xml = await loadOpenspecXml({ git, defaultBranch: 'main', changeName: 'ghost' });
    expect(xml).toBe([
      '<openspec>',
      '  <name>ghost</name>',
      '</openspec>',
    ].join('\n'));
  });
});

describe('loadOpenspecXmlForTask', () => {
  it('skips git for a regular card', async () => {
    const git: OpenspecXmlGit = { show: vi.fn(), lsTreeFiles: vi.fn() };
    const xml = await loadOpenspecXmlForTask({
      task: { card_kind: 'regular', openspec_change: 'add-login' },
      projectPath: 'C:/Users/dev/project',
      defaultBranch: 'main',
      git,
    });
    expect(xml).toBe('');
    expect(git.show).not.toHaveBeenCalled();
  });

  it('returns empty when a change card has no name or project path', async () => {
    const git: OpenspecXmlGit = { show: vi.fn(), lsTreeFiles: vi.fn() };
    expect(await loadOpenspecXmlForTask({
      task: { card_kind: 'change', openspec_change: null },
      projectPath: 'C:/Users/dev/project',
      defaultBranch: 'main',
      git,
    })).toBe('');
    expect(await loadOpenspecXmlForTask({
      task: { card_kind: 'change', openspec_change: 'add-login' },
      projectPath: null,
      defaultBranch: 'main',
      git,
    })).toBe('');
    expect(git.show).not.toHaveBeenCalled();
  });

  it('returns empty when git throws', async () => {
    const git: OpenspecXmlGit = {
      show: vi.fn(async () => { throw new Error('fatal: not a git repository'); }),
      lsTreeFiles: vi.fn(async () => { throw new Error('fatal: not a git repository'); }),
    };
    expect(await loadOpenspecXmlForTask({
      task: { card_kind: 'change', openspec_change: 'add-login' },
      projectPath: 'C:/Users/dev/project',
      defaultBranch: 'main',
      git,
    })).toBe('');
  });
});

describe('{{openspec_xml}} resolver', () => {
  function makeTask(overrides: Partial<Task> = {}): Task {
    return {
      id: 'task-1',
      display_id: 1,
      title: 'Add login',
      description: '',
      swimlane_id: 'lane-1',
      position: 0,
      agent: null,
      labels: [],
      priority: 0,
      created_at: '2026-11-04T00:00:00.000Z',
      updated_at: '2026-11-04T00:00:00.000Z',
      card_kind: 'regular',
      task_intent: 'work',
      ...overrides,
    } as Task;
  }

  it('resolves the pre-loaded envelope and stays empty when omitted', () => {
    const envelope = '<openspec>\n  <name>add-login</name>\n</openspec>';
    expect(resolveTaskTemplateVars({
      task: makeTask({ card_kind: 'change', openspec_change: 'add-login' }),
      defaultBaseBranch: 'main',
      attachmentPaths: [],
      openspecXml: envelope,
    }).openspec_xml).toBe(envelope);
    expect(resolveTaskTemplateVars({
      task: makeTask(),
      defaultBaseBranch: 'main',
      attachmentPaths: [],
    }).openspec_xml).toBe('');
  });
});
