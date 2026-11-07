/**
 * Discuss-card spawn prepend: a fresh spawn of a `task_intent: 'discuss'`
 * card opens with `/opsx-explore`. Resume and handoff must not prepend again,
 * a prompt that already starts with the command is left alone, and work
 * intent never prepends.
 *
 * `openspecExplorePromptPrefix` is the decision. spawnAgent wiring asserts
 * the 7th arg of `resumeSuspendedSession` (`handoffPromptPrefix`), which is
 * the slot the engine prepends to the interpolated task template. Putting the
 * command in `resumePrompt` would leave it unsent on a fresh spawn.
 *
 * Harness mirrors spawn-agent-continuation-prompt.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Task, Swimlane, SessionRecord } from '../../src/shared/types';
import { OPENSPEC_EXPLORE_COMMAND, OPENSPEC_PROPOSE_DEFAULT_BRANCH_NOTE } from '../../src/shared/openspec-commands';

const DISCUSS_PREFIX = `${OPENSPEC_EXPLORE_COMMAND}\n\n${OPENSPEC_PROPOSE_DEFAULT_BRANCH_NOTE}`;

vi.mock('../../src/main/transition-engine/agent-resolver', () => ({
  resolveTargetAgent: vi.fn(() => ({ agent: 'claude', isHandoff: false })),
}));

vi.mock('../../src/main/agent/agent-registry', () => ({
  agentRegistry: { get: vi.fn(() => ({ sessionType: 'claude_agent' })) },
}));

import { openspecExplorePromptPrefix, resolveSkipPromptTemplate, spawnAgent } from '../../src/main/ipc/helpers/agent-spawn';
import { resolveTargetAgent } from '../../src/main/transition-engine/agent-resolver';
import { agentRegistry } from '../../src/main/agent/agent-registry';

const TASK_ID = 'task-openspec-1';
const PLANNING_LANE_ID = 'lane-planning';
const FRESH_PTY_SESSION_ID = 'pty-fresh-1';

function prefixFor(overrides: Partial<Parameters<typeof openspecExplorePromptPrefix>[0]> = {}) {
  return openspecExplorePromptPrefix({
    taskIntent: 'discuss',
    isFreshSpawn: true,
    isHandoff: false,
    existingPrompt: undefined,
    ...overrides,
  });
}

describe('openspecExplorePromptPrefix', () => {
  it('returns /opsx-explore plus the default-branch note for a discuss card on a fresh spawn', () => {
    expect(prefixFor()).toBe(DISCUSS_PREFIX);
    expect(prefixFor()).toContain(OPENSPEC_EXPLORE_COMMAND);
    expect(prefixFor()).toContain(OPENSPEC_PROPOSE_DEFAULT_BRANCH_NOTE);
  });

  it('returns undefined on a resume', () => {
    expect(prefixFor({ isFreshSpawn: false })).toBeUndefined();
  });

  it('returns undefined on a handoff', () => {
    expect(prefixFor({ isHandoff: true })).toBeUndefined();
  });

  it('returns undefined for work intent', () => {
    expect(prefixFor({ taskIntent: 'work' })).toBeUndefined();
  });

  it('does not prepend on a change card, even with discuss intent', () => {
    expect(prefixFor({ cardKind: 'change', taskIntent: 'discuss' })).toBeUndefined();
  });

  it('does not duplicate when the prompt already starts with the command', () => {
    expect(prefixFor({ existingPrompt: `${OPENSPEC_EXPLORE_COMMAND}\n\nLook at the auth flow.` })).toBeUndefined();
    expect(prefixFor({ existingPrompt: `  ${OPENSPEC_EXPLORE_COMMAND}` })).toBeUndefined();
  });
});

describe('resolveSkipPromptTemplate', () => {
  it('skips when the caller asked to skip', () => {
    expect(resolveSkipPromptTemplate(true, 'regular')).toBe(true);
  });

  it('skips a change card even when the caller did not ask', () => {
    expect(resolveSkipPromptTemplate(false, 'change')).toBe(true);
    expect(resolveSkipPromptTemplate(undefined, 'change')).toBe(true);
  });

  it('keeps a regular card\'s To Do spawn on the task template', () => {
    expect(resolveSkipPromptTemplate(false, 'regular')).toBe(false);
    expect(resolveSkipPromptTemplate(undefined, 'regular')).toBe(false);
    expect(resolveSkipPromptTemplate(undefined, undefined)).toBe(false);
  });
});

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    display_id: 1,
    title: 'Discuss the auth flow',
    description: 'How should login work?',
    swimlane_id: PLANNING_LANE_ID,
    position: 0,
    agent: 'claude',
    agent_override: null,
    model_override: null,
    effort_override: null,
    session_id: null,
    worktree_path: '/mock/project/.kangentic/worktrees/auth',
    branch_name: 'auth',
    pr_number: null,
    pr_url: null,
    base_branch: null,
    use_worktree: null,
    labels: [],
    priority: 0,
    attachment_count: 0,
    archived_at: null,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    task_intent: 'work',
    ...overrides,
  };
}

function makeSwimlane(overrides: Partial<Swimlane> = {}): Swimlane {
  return {
    id: PLANNING_LANE_ID,
    name: 'Planning',
    role: null,
    position: 0,
    color: '#888',
    icon: null,
    is_archived: false,
    is_ghost: false,
    permission_mode: null,
    auto_spawn: true,
    auto_command: null,
    plan_exit_target_id: null,
    agent_override: null,
    model_override: null,
    effort_override: null,
    handoff_context: false,
    session_target: 'main',
    session_spawn_strategy: 'create_or_resume',
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'rec-main',
    task_id: TASK_ID,
    session_type: 'claude_agent',
    isolated_swimlane_id: null,
    agent_session_id: 'agent-sid-1',
    pty_session_id: null,
    status: 'suspended',
    suspended_by: 'system',
    permission_mode: 'plan',
    started_at: '2026-01-01T00:00:00.000Z',
    exited_at: null,
    exit_code: null,
    duration_ms: null,
    cost_usd: null,
    input_tokens: null,
    output_tokens: null,
    model: null,
    effort: null,
    ...overrides,
  } as SessionRecord;
}

function makeDeps(args: { resumeRecord: SessionRecord | undefined; taskFields?: Partial<Task> }) {
  let sessionStarted = false;
  const getById = vi.fn(() => makeTask({
    session_id: sessionStarted ? FRESH_PTY_SESSION_ID : null,
    ...args.taskFields,
  }));

  const tasks = { getById };
  const sessionRepo = {
    getLatestForTask: vi.fn(() => args.resumeRecord ?? null),
    getLatestForTaskByTypeAndIsolation: vi.fn(() => args.resumeRecord),
  };
  const engine = {
    executeTransition: vi.fn(async () => ({ outcomes: [], failures: [], startedAgent: false })),
    resumeSuspendedSession: vi.fn(async () => { sessionStarted = true; }),
  };
  const context = {
    terminalSubmitScheduler: { scheduleKeystrokes: vi.fn() },
    configManager: {
      getEffectiveConfig: vi.fn(() => ({
        agent: { permissionMode: 'acceptEdits' },
        git: { defaultBaseBranch: 'main' },
      })),
    },
    boardConfigManager: { getDefaultBaseBranch: vi.fn(() => undefined) },
  };

  return { tasks, sessionRepo, engine, context, taskFields: args.taskFields };
}

async function runSpawn(
  deps: ReturnType<typeof makeDeps>,
  extra: { skipPromptTemplate?: boolean } = {},
) {
  await spawnAgent({
    context: deps.context as never,
    engine: deps.engine as never,
    tasks: deps.tasks as never,
    sessionRepo: deps.sessionRepo as never,
    task: makeTask({ swimlane_id: PLANNING_LANE_ID, session_id: null, ...deps.taskFields }),
    fromSwimlaneId: '*',
    toLane: makeSwimlane(),
    ...extra,
  });
}

function promptPrefixArg(engine: ReturnType<typeof makeDeps>['engine']): unknown {
  return engine.resumeSuspendedSession.mock.calls[0]?.[6];
}

describe('spawnAgent OpenSpec explore prefix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveTargetAgent).mockImplementation(() => ({ agent: 'claude', isHandoff: false }));
    vi.mocked(agentRegistry.get).mockImplementation(() => ({ sessionType: 'claude_agent' }) as never);
  });

  it('passes /opsx-explore as the prompt prefix on a discuss fresh spawn', async () => {
    const deps = makeDeps({ resumeRecord: undefined, taskFields: { task_intent: 'discuss' } });
    await runSpawn(deps);
    expect(promptPrefixArg(deps.engine)).toBe(DISCUSS_PREFIX);
  });

  it('does not prepend on a discuss resume', async () => {
    const deps = makeDeps({ resumeRecord: makeRecord(), taskFields: { task_intent: 'discuss' } });
    await runSpawn(deps, { skipPromptTemplate: true });
    expect(promptPrefixArg(deps.engine)).toBeUndefined();
  });

  it('does not prepend on a discuss handoff', async () => {
    vi.mocked(resolveTargetAgent).mockImplementation(() => ({ agent: 'codex', isHandoff: true }));
    vi.mocked(agentRegistry.get).mockImplementation(() => ({ sessionType: 'codex_agent' }) as never);
    const deps = makeDeps({ resumeRecord: undefined, taskFields: { task_intent: 'discuss' } });
    await runSpawn(deps);
    expect(promptPrefixArg(deps.engine)).toBeUndefined();
  });

  it('does not prepend for work intent', async () => {
    const deps = makeDeps({ resumeRecord: undefined, taskFields: { task_intent: 'work' } });
    await runSpawn(deps);
    expect(promptPrefixArg(deps.engine)).toBeUndefined();
  });
});
