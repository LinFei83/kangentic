/**
 * Default-branch OpenSpec scan: tree-SHA short-circuit, create vs note-only
 * update, archive stamp, missing CLI still creating a card, and de-dupe
 * through getByOpenspecChange (including Done rows). Git and evaluate are
 * mocked. Uncommitted workspace files never appear because listing is injected
 * ls-tree output.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/main/ipc/send-to-renderer', () => ({ sendToRenderer: vi.fn() }));
vi.mock('../../src/main/ipc/helpers/task-write-announce', () => ({ announceTaskBoardChange: vi.fn() }));
vi.mock('../../src/main/ipc/helpers/project-repos', () => ({ getProjectRepos: vi.fn() }));
vi.mock('../../src/main/ipc/handlers/git-stats-capture', () => ({
  resolveDefaultBaseBranch: vi.fn(() => 'main'),
}));
vi.mock('../../src/main/git/simple-git-client', () => ({ openSimpleGit: vi.fn() }));
vi.mock('../../src/main/shutdown-state', () => ({ isShuttingDown: () => false }));
import type { Project, Task, TaskCreateInput } from '../../src/shared/types';
import {
  activeChangeNames,
  archiveChangeName,
  parseProposal,
  scanOpenspecChanges,
  type OpenspecGitOps,
  type OpenspecSwimlaneStore,
  type OpenspecTaskStore,
} from '../../src/main/openspec/scan';
import type { OpenspecNoteToken } from '../../src/main/openspec/evaluate-change';

const TODO_ID = 'todo-lane';
const PROJECT = { id: 'proj-1', path: '/mock/repo', name: 'repo' } as Project;

function makeTask(overrides: Partial<Task> & Pick<Task, 'id' | 'openspec_change'>): Task {
  return {
    title: overrides.openspec_change ?? 'change',
    description: '',
    swimlane_id: TODO_ID,
    card_kind: 'change',
    task_intent: 'work',
    openspec_note: 'ready',
    archived_at: null,
    ...overrides,
  } as Task;
}

function makeGit(options: {
  treeSha?: string | null;
  dirs?: string[];
  archiveDirs?: string[];
  files?: Record<string, string>;
}): OpenspecGitOps {
  const treeSha = options.treeSha === undefined ? 'tree-aaa' : options.treeSha;
  const dirs = options.dirs ?? [];
  const archiveDirs = options.archiveDirs ?? [];
  const files = options.files ?? {};
  return {
    async revParse(spec: string) {
      if (spec.endsWith(':openspec/changes')) {
        if (treeSha === null) {
          throw new Error("fatal: path 'openspec/changes' does not exist in 'main'");
        }
        return treeSha;
      }
      throw new Error(`unexpected rev-parse ${spec}`);
    },
    async lsTreeDirs(spec: string) {
      if (spec.endsWith(':openspec/changes')) return dirs;
      if (spec.endsWith(':openspec/changes/archive')) return archiveDirs;
      throw new Error(`unexpected ls-tree ${spec}`);
    },
    async show(spec: string) {
      const contents = files[spec];
      if (contents === undefined) {
        throw new Error(`fatal: path does not exist: ${spec}`);
      }
      return contents;
    },
  };
}

type TaskUpdateRecord = {
  id: string;
  openspec_note?: string | null;
  openspec_change?: string | null;
  title?: string;
  description?: string;
};

function makeTasks(existing: Map<string, Task> = new Map()): OpenspecTaskStore & {
  created: TaskCreateInput[];
  updated: TaskUpdateRecord[];
} {
  const created: TaskCreateInput[] = [];
  const updated: TaskUpdateRecord[] = [];
  return {
    created,
    updated,
    getByOpenspecChange(name: string) {
      return existing.get(name);
    },
    create(input: TaskCreateInput) {
      created.push(input);
      const task = makeTask({
        id: `created-${input.openspec_change}`,
        openspec_change: input.openspec_change ?? null,
        title: input.title,
        description: input.description,
        openspec_note: input.openspec_note ?? null,
        card_kind: input.card_kind === 'change' ? 'change' : 'regular',
      });
      existing.set(input.openspec_change ?? '', task);
      return task;
    },
    update(input) {
      const record: TaskUpdateRecord = { id: input.id };
      if (input.openspec_note !== undefined) record.openspec_note = input.openspec_note;
      if (input.openspec_change !== undefined) record.openspec_change = input.openspec_change;
      if (input.title !== undefined) record.title = input.title;
      if (input.description !== undefined) record.description = input.description;
      updated.push(record);
      for (const [key, task] of existing.entries()) {
        if (task.id !== input.id) continue;
        if (input.openspec_note !== undefined) task.openspec_note = input.openspec_note ?? null;
        if (input.title !== undefined) task.title = input.title;
        if (input.description !== undefined) task.description = input.description;
        if (input.openspec_change !== undefined) {
          task.openspec_change = input.openspec_change ?? null;
          if (key !== (input.openspec_change ?? '')) {
            existing.delete(key);
            existing.set(input.openspec_change ?? '', task);
          }
        }
        return task;
      }
      throw new Error(`update of unknown task ${input.id}`);
    },
  };
}

const swimlanes: OpenspecSwimlaneStore = {
  list: () => [{ id: TODO_ID, role: 'todo' }],
};

describe('activeChangeNames / archiveChangeName / parseProposal', () => {
  it('skips archive and dot directories', () => {
    expect(activeChangeNames(['add-rate-limiting', 'archive', '.hidden'])).toEqual(['add-rate-limiting']);
  });

  it('strips the archive date prefix', () => {
    expect(archiveChangeName('2026-11-04-add-rate-limiting')).toBe('add-rate-limiting');
    expect(archiveChangeName('plain-name')).toBe('plain-name');
  });

  it('takes the first heading and the paragraph under it', () => {
    const parsed = parseProposal(
      '# Add rate limiting\n\nCap requests per token.\n\n## Why\n\nBecause.\n',
      'add-rate-limiting',
    );
    expect(parsed.title).toBe('Add rate limiting');
    expect(parsed.description).toBe('Cap requests per token.');
  });

  it('falls back to the directory name when proposal has no heading', () => {
    expect(parseProposal('No heading here.', 'add-rate-limiting')).toEqual({
      title: 'add-rate-limiting',
      description: 'No heading here.',
    });
  });
});

describe('scanOpenspecChanges', () => {
  it('returns without listing when the tree SHA is unchanged', async () => {
    const git = makeGit({ treeSha: 'tree-aaa', dirs: ['add-rate-limiting'] });
    const tasks = makeTasks();
    const evaluate = vi.fn(async (): Promise<OpenspecNoteToken> => 'ready');
    const result = await scanOpenspecChanges({
      project: PROJECT,
      defaultBranch: 'main',
      tasks,
      swimlanes,
      git,
      lastTreeSha: 'tree-aaa',
      evaluate,
    });
    expect(result).toEqual({ treeSha: 'tree-aaa', skipped: true, created: [], updated: [] });
    expect(evaluate).not.toHaveBeenCalled();
    expect(tasks.created).toHaveLength(0);
  });

  it('creates a To Do change card with the OpenSpec payload when none exists', async () => {
    const git = makeGit({
      dirs: ['add-rate-limiting', 'archive'],
      files: {
        'main:openspec/changes/add-rate-limiting/proposal.md': '# Add rate limiting\n\nCap requests per token.\n',
        'main:openspec/changes/add-rate-limiting/tasks.md': '- [ ] one\n',
      },
    });
    const tasks = makeTasks();
    const result = await scanOpenspecChanges({
      project: PROJECT,
      defaultBranch: 'main',
      tasks,
      swimlanes,
      git,
      lastTreeSha: null,
      evaluate: async () => 'ready',
    });
    expect(result.skipped).toBe(false);
    expect(result.created).toEqual(['created-add-rate-limiting']);
    expect(tasks.created).toEqual([
      {
        title: 'Add rate limiting',
        description: 'Cap requests per token.',
        swimlane_id: TODO_ID,
        card_kind: 'change',
        openspec_change: 'add-rate-limiting',
        openspec_note: 'ready',
        externalSource: 'openspec',
        externalId: 'add-rate-limiting',
      },
    ]);
    expect(tasks.created[0].task_intent).toBeUndefined();
  });

  it('still creates a card when evaluate stamps missing (CLI absent)', async () => {
    const git = makeGit({
      dirs: ['add-rate-limiting'],
      files: {},
    });
    const tasks = makeTasks();
    await scanOpenspecChanges({
      project: PROJECT,
      defaultBranch: 'main',
      tasks,
      swimlanes,
      git,
      lastTreeSha: null,
      evaluate: async () => 'missing',
    });
    expect(tasks.created[0]?.openspec_note).toBe('missing');
    expect(tasks.created[0]?.card_kind).toBe('change');
    expect(tasks.created[0]?.openspec_change).toBe('add-rate-limiting');
  });

  it('updates openspec_note only when the token changed, and does not move columns', async () => {
    const existing = makeTask({
      id: 'task-1',
      openspec_change: 'add-rate-limiting',
      openspec_note: 'ready',
      swimlane_id: 'executing-lane',
    });
    const tasks = makeTasks(new Map([['add-rate-limiting', existing]]));
    const git = makeGit({ dirs: ['add-rate-limiting'], files: {} });

    await scanOpenspecChanges({
      project: PROJECT,
      defaultBranch: 'main',
      tasks,
      swimlanes,
      git,
      lastTreeSha: null,
      evaluate: async () => 'ready',
    });
    expect(tasks.updated).toHaveLength(0);
    expect(tasks.created).toHaveLength(0);

    await scanOpenspecChanges({
      project: PROJECT,
      defaultBranch: 'main',
      tasks,
      swimlanes,
      git,
      lastTreeSha: 'other-tree',
      evaluate: async () => 'tasks:3/12',
    });
    expect(tasks.updated).toEqual([{ id: 'task-1', openspec_note: 'tasks:3/12' }]);
    expect(existing.swimlane_id).toBe('executing-lane');
  });

  it('does not rewrite a regular or discussion card that already owns the name', async () => {
    const existing = makeTask({
      id: 'discuss-1',
      openspec_change: 'add-rate-limiting',
      card_kind: 'regular',
      task_intent: 'discuss',
      openspec_note: null,
    });
    const tasks = makeTasks(new Map([['add-rate-limiting', existing]]));
    await scanOpenspecChanges({
      project: PROJECT,
      defaultBranch: 'main',
      tasks,
      swimlanes,
      git: makeGit({ dirs: ['add-rate-limiting'], files: {} }),
      lastTreeSha: null,
      evaluate: async () => 'ready',
    });
    expect(tasks.created).toHaveLength(0);
    expect(tasks.updated).toHaveLength(0);
  });

  it('de-dupes via getByOpenspecChange, including a Done row', async () => {
    const existing = makeTask({
      id: 'done-1',
      openspec_change: 'add-rate-limiting',
      archived_at: '2026-11-01T00:00:00.000Z',
      swimlane_id: 'done-lane',
      openspec_note: 'tasks:12/12',
    });
    const tasks = makeTasks(new Map([['add-rate-limiting', existing]]));
    await scanOpenspecChanges({
      project: PROJECT,
      defaultBranch: 'main',
      tasks,
      swimlanes,
      git: makeGit({ dirs: ['add-rate-limiting'], files: {} }),
      lastTreeSha: null,
      evaluate: async () => 'tasks:12/12',
    });
    expect(tasks.created).toHaveLength(0);
    expect(tasks.getByOpenspecChange('add-rate-limiting')?.id).toBe('done-1');
  });

  it('stamps archived on a still-on-board change card and does not move it to Done', async () => {
    const existing = makeTask({
      id: 'task-1',
      openspec_change: 'add-rate-limiting',
      openspec_note: 'tasks:12/12',
      swimlane_id: 'merge-lane',
    });
    const tasks = makeTasks(new Map([['add-rate-limiting', existing]]));
    await scanOpenspecChanges({
      project: PROJECT,
      defaultBranch: 'main',
      tasks,
      swimlanes,
      git: makeGit({
        dirs: ['archive'],
        archiveDirs: ['2026-11-04-add-rate-limiting'],
      }),
      lastTreeSha: null,
      evaluate: async () => 'ready',
    });
    expect(tasks.created).toHaveLength(0);
    expect(tasks.updated).toEqual([{ id: 'task-1', openspec_note: 'archived' }]);
    expect(existing.swimlane_id).toBe('merge-lane');
  });

  it('does not create a card for an archive-only name', async () => {
    const tasks = makeTasks();
    await scanOpenspecChanges({
      project: PROJECT,
      defaultBranch: 'main',
      tasks,
      swimlanes,
      git: makeGit({
        dirs: ['archive'],
        archiveDirs: ['2026-11-04-add-rate-limiting'],
      }),
      lastTreeSha: null,
      evaluate: async () => 'archived',
    });
    expect(tasks.created).toHaveLength(0);
    expect(tasks.updated).toHaveLength(0);
  });

  it('rewrites a card stored under git\'s C-quoted name instead of creating a second one', async () => {
    const quotedName = '"\\345\\210\\233\\345\\273\\272\\346\\265\\213\\350\\257\\225\\345\\217\\230\\346\\233\\264"';
    const changeName = '创建测试变更';
    const existing = makeTask({
      id: 'task-garbled',
      openspec_change: quotedName,
      title: quotedName,
      description: '',
      openspec_note: 'invalid',
    });
    const tasks = makeTasks(new Map([[quotedName, existing]]));
    await scanOpenspecChanges({
      project: PROJECT,
      defaultBranch: 'main',
      tasks,
      swimlanes,
      git: makeGit({
        dirs: [changeName],
        files: {
          [`main:openspec/changes/${changeName}/proposal.md`]: '# Ship the change\n\nDo the work.\n',
          [`main:openspec/changes/${changeName}/tasks.md`]: '- [ ] one\n',
        },
      }),
      lastTreeSha: null,
      evaluate: async () => 'ready',
    });
    expect(tasks.created).toHaveLength(0);
    expect(tasks.updated).toEqual([{
      id: 'task-garbled',
      openspec_change: changeName,
      title: 'Ship the change',
      description: 'Do the work.',
      openspec_note: 'ready',
    }]);
    expect(tasks.getByOpenspecChange(changeName)?.id).toBe('task-garbled');
  });

  it('keeps the real-name card when a quoted leftover also exists', async () => {
    const quotedName = '"\\345\\210\\233\\345\\273\\272\\346\\265\\213\\350\\257\\225\\345\\217\\230\\346\\233\\264"';
    const changeName = '创建测试变更';
    const real = makeTask({
      id: 'task-real',
      openspec_change: changeName,
      title: 'Ship the change',
      openspec_note: 'ready',
    });
    const garbled = makeTask({
      id: 'task-garbled',
      openspec_change: quotedName,
      title: quotedName,
      openspec_note: 'invalid',
    });
    const tasks = makeTasks(new Map([[changeName, real], [quotedName, garbled]]));
    await scanOpenspecChanges({
      project: PROJECT,
      defaultBranch: 'main',
      tasks,
      swimlanes,
      git: makeGit({ dirs: [changeName], files: {} }),
      lastTreeSha: null,
      evaluate: async () => 'ready',
    });
    expect(tasks.created).toHaveLength(0);
    expect(tasks.updated).toHaveLength(0);
    expect(tasks.getByOpenspecChange(quotedName)?.id).toBe('task-garbled');
  });

  it('repairs a quoted name when stamping archived', async () => {
    const quotedName = '"\\345\\210\\233\\345\\273\\272\\346\\265\\213\\350\\257\\225\\345\\217\\230\\346\\233\\264"';
    const changeName = '创建测试变更';
    const existing = makeTask({
      id: 'task-garbled',
      openspec_change: quotedName,
      title: quotedName,
      openspec_note: 'invalid',
      swimlane_id: 'merge-lane',
    });
    const tasks = makeTasks(new Map([[quotedName, existing]]));
    await scanOpenspecChanges({
      project: PROJECT,
      defaultBranch: 'main',
      tasks,
      swimlanes,
      git: makeGit({
        dirs: ['archive'],
        archiveDirs: [`2026-11-04-${changeName}`],
      }),
      lastTreeSha: null,
      evaluate: async () => 'archived',
    });
    expect(tasks.created).toHaveLength(0);
    expect(tasks.updated).toEqual([{
      id: 'task-garbled',
      openspec_note: 'archived',
      openspec_change: changeName,
    }]);
    expect(existing.swimlane_id).toBe('merge-lane');
  });
});
