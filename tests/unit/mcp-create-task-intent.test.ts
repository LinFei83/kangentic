/**
 * kangentic_create_task `intent` maps to `task_intent` on create. Omitted
 * defaults to work in the repository (the handler leaves the key off). An
 * unknown value is refused before the row is written, including on the mobile
 * bridge path that never sees the zod schema.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTaskRepoCreate = vi.fn();
const mockResolveColumn = vi.fn();

vi.mock('../../src/main/db/repositories/task-repository', () => ({
  TaskRepository: class {
    create = mockTaskRepoCreate;
    update = vi.fn();
    getById = vi.fn();
    getByDisplayId = vi.fn();
  },
}));

vi.mock('../../src/main/agent/commands/column-resolver', () => ({
  resolveColumn: (...args: unknown[]) => mockResolveColumn(...args),
}));

vi.mock('../../src/main/db/repositories/attachment-repository', () => ({
  AttachmentRepository: class { add = vi.fn(); list = vi.fn(() => []); },
}));
vi.mock('../../src/main/db/repositories/session-repository', () => ({
  SessionRepository: class {},
}));
vi.mock('../../src/main/db/repositories/backlog-repository', () => ({
  BacklogRepository: class { create = vi.fn(); getById = vi.fn(); update = vi.fn(); list = vi.fn(() => []); },
}));
vi.mock('../../src/main/db/repositories/backlog-attachment-repository', () => ({
  BacklogAttachmentRepository: class { add = vi.fn(); list = vi.fn(() => []); deleteByTaskId = vi.fn(); },
}));
vi.mock('../../src/main/db/repositories/attachment-utils', () => ({
  readFileAsAttachment: vi.fn(),
}));
vi.mock('../../src/main/pr/pr-linking', () => ({
  linkPRForTask: vi.fn(),
}));

import { handleCreateTask } from '../../src/main/agent/commands/task-commands';
import type { CommandContext } from '../../src/main/agent/commands/types';

function makeContext(): CommandContext {
  return {
    getProjectDb: vi.fn(() => ({}) as never),
    getProjectPath: vi.fn(() => '/mock/project'),
    onBacklogChanged: vi.fn(),
    onLabelColorsChanged: vi.fn(),
    onTaskCreated: vi.fn(),
    onTaskUpdated: vi.fn(),
    onTaskDeleted: vi.fn(),
    onTaskMove: vi.fn(async () => {}),
    onTasksReordered: vi.fn(),
    onSwimlaneUpdated: vi.fn(),
    onSwimlaneDeleted: vi.fn(),
  };
}

describe('handleCreateTask - intent maps to task_intent', () => {
  let context: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context = makeContext();
    mockResolveColumn.mockReturnValue({ swimlane: { id: 'lane-1', name: 'To Do' } });
    mockTaskRepoCreate.mockImplementation((input: { title: string }) => ({
      id: 'task-uuid-1',
      display_id: 1,
      title: input.title,
    }));
  });

  it('forwards intent: "discuss" as task_intent and stores Project (useWorktree false)', async () => {
    const result = await handleCreateTask({ title: 'Talk through auth', intent: 'discuss' }, context);

    expect(result.success).toBe(true);
    expect(mockTaskRepoCreate).toHaveBeenCalledOnce();
    expect(mockTaskRepoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ task_intent: 'discuss', useWorktree: false }),
    );
  });

  it('stores a discuss card as Project even when the caller asked for a worktree', async () => {
    const result = await handleCreateTask(
      { title: 'Talk through auth', intent: 'discuss', useWorktree: true },
      context,
    );

    expect(result.success).toBe(true);
    expect(mockTaskRepoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ task_intent: 'discuss', useWorktree: false }),
    );
  });

  it('forwards intent: "work" as task_intent', async () => {
    const result = await handleCreateTask({ title: 'Fix the crash', intent: 'work' }, context);

    expect(result.success).toBe(true);
    expect(mockTaskRepoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ task_intent: 'work' }),
    );
  });

  it('omits task_intent when intent is not passed, so the repository default applies', async () => {
    const result = await handleCreateTask({ title: 'Ordinary task' }, context);

    expect(result.success).toBe(true);
    expect(mockTaskRepoCreate).toHaveBeenCalledOnce();
    const createInput = mockTaskRepoCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createInput).not.toHaveProperty('task_intent');
  });

  it('refuses an unknown intent and creates nothing', async () => {
    const result = await handleCreateTask({ title: 'Bad intent', intent: 'explore' }, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('work');
    expect(result.error).toContain('discuss');
    expect(mockTaskRepoCreate).not.toHaveBeenCalled();
  });
});
