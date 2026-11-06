import { describe, expect, it } from 'vitest';
import {
  taskUsesWorktree,
  storedWorktreeChoice,
  isDiscussCard,
  isPlanningColumn,
  discussCardSkipsWorktreeInPlanning,
} from '../../src/shared/worktree-choice';

// The one rule main (`ensureWorktree`) and the renderer (the New Task dialog,
// the edit form, the branch hint) both decide by.
describe('taskUsesWorktree', () => {
  it('gives no task a worktree while the Worktrees switch is off, whatever the task picked', () => {
    expect(taskUsesWorktree(false, null)).toBe(false);
    expect(taskUsesWorktree(false, true)).toBe(false);
    expect(taskUsesWorktree(false, false)).toBe(false);
  });

  it('with the switch on, an unset choice means Worktree and a set one wins', () => {
    expect(taskUsesWorktree(true, null)).toBe(true);
    expect(taskUsesWorktree(true, undefined)).toBe(true);
    expect(taskUsesWorktree(true, true)).toBe(true);
    expect(taskUsesWorktree(true, false)).toBe(false);
  });
});

describe('storedWorktreeChoice', () => {
  it('reads the tri-state column as a choice', () => {
    expect(storedWorktreeChoice(1)).toBe(true);
    expect(storedWorktreeChoice(0)).toBe(false);
    expect(storedWorktreeChoice(null)).toBe(null);
    expect(storedWorktreeChoice(undefined)).toBe(null);
  });
});

describe('discussCardSkipsWorktreeInPlanning', () => {
  const planLane = { permission_mode: 'plan', plan_exit_target_id: null };
  const exitTargetLane = { permission_mode: 'acceptEdits', plan_exit_target_id: 'lane-exec' };
  const executingLane = { permission_mode: 'acceptEdits', plan_exit_target_id: null };

  it.each([
    { name: 'discuss in permission-mode plan', card_kind: 'regular' as const, task_intent: 'discuss' as const, lane: planLane, skip: true },
    { name: 'discuss in plan-exit-target column', card_kind: 'regular' as const, task_intent: 'discuss' as const, lane: exitTargetLane, skip: true },
    { name: 'discuss in Executing', card_kind: 'regular' as const, task_intent: 'discuss' as const, lane: executingLane, skip: false },
    { name: 'work card in Planning', card_kind: 'regular' as const, task_intent: 'work' as const, lane: planLane, skip: false },
    { name: 'change card with discuss intent in Planning', card_kind: 'change' as const, task_intent: 'discuss' as const, lane: planLane, skip: false },
    { name: 'change card in Planning', card_kind: 'change' as const, task_intent: 'work' as const, lane: planLane, skip: false },
    { name: 'discuss with no column', card_kind: 'regular' as const, task_intent: 'discuss' as const, lane: null, skip: false },
  ])('$name -> skip=$skip', ({ card_kind, task_intent, lane, skip }) => {
    expect(discussCardSkipsWorktreeInPlanning({ card_kind, task_intent }, lane)).toBe(skip);
  });

  it('treats an unset card_kind as regular, so a discuss intent still skips in Planning', () => {
    expect(isDiscussCard({ task_intent: 'discuss' })).toBe(true);
    expect(isPlanningColumn(planLane)).toBe(true);
    expect(discussCardSkipsWorktreeInPlanning({ task_intent: 'discuss' }, planLane)).toBe(true);
  });
});
