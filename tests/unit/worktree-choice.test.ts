import { describe, expect, it } from 'vitest';
import {
  taskUsesWorktree,
  storedWorktreeChoice,
  isDiscussCard,
  persistedUseWorktree,
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

describe('persistedUseWorktree', () => {
  it('stores a regular discuss card as Project even when the caller asked for a worktree', () => {
    expect(persistedUseWorktree({ card_kind: 'regular', task_intent: 'discuss' }, null)).toBe(0);
    expect(persistedUseWorktree({ card_kind: 'regular', task_intent: 'discuss' }, true)).toBe(0);
    expect(persistedUseWorktree({ task_intent: 'discuss' }, false)).toBe(0);
  });

  it('keeps the requested tri-state for a work card', () => {
    expect(persistedUseWorktree({ card_kind: 'regular', task_intent: 'work' }, null)).toBeNull();
    expect(persistedUseWorktree({ task_intent: 'work' }, true)).toBe(1);
    expect(persistedUseWorktree({ task_intent: 'work' }, false)).toBe(0);
  });

  it('ignores discuss on a change card', () => {
    expect(persistedUseWorktree({ card_kind: 'change', task_intent: 'discuss' }, null)).toBeNull();
    expect(persistedUseWorktree({ card_kind: 'change', task_intent: 'discuss' }, true)).toBe(1);
  });
});

describe('isDiscussCard', () => {
  it('treats an unset card_kind as regular', () => {
    expect(isDiscussCard({ task_intent: 'discuss' })).toBe(true);
    expect(isDiscussCard({ card_kind: 'change', task_intent: 'discuss' })).toBe(false);
    expect(isDiscussCard({ task_intent: 'work' })).toBe(false);
  });
});
