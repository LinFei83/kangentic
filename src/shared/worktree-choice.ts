import type { TaskCardKind, TaskIntent } from './types';

/**
 * Whether a task runs in its own git worktree. Main (`ensureWorktree`) and the
 * renderer (the New Task dialog, the task edit form, the branch hint) both
 * decide through this, so the hint can never promise a worktree the spawn then
 * skips.
 *
 * `git.worktreesEnabled` is the feature switch, not a default. Off, no task
 * gets a worktree, including one created earlier with Worktree picked; the
 * dialog hides the choice. On, a task's own choice wins and an unset choice
 * means Worktree. A task that already has a live worktree keeps it either way,
 * because `ensureWorktree` reuses a live directory before it asks this.
 *
 * A regular discuss card is stored as Project (`use_worktree = 0`) at create
 * and update (`persistedUseWorktree`), so OpenSpec proposals land in the
 * project folder the default-branch scan reads. That is the existing
 * `disabled` skip, not a separate spawn-time reason.
 */
export function taskUsesWorktree(worktreesEnabled: boolean, taskChoice: boolean | null | undefined): boolean {
  if (!worktreesEnabled) return false;
  return taskChoice ?? true;
}

/** The stored tri-state column (`tasks.use_worktree`, 1 / 0 / NULL) as the choice `taskUsesWorktree` reads. */
export function storedWorktreeChoice(useWorktree: number | null | undefined): boolean | null {
  return useWorktree == null ? null : Boolean(useWorktree);
}

/** A regular discuss card. Change cards ignore `task_intent`. */
export function isDiscussCard(task: {
  card_kind?: TaskCardKind | null;
  task_intent?: TaskIntent | null;
}): boolean {
  return task.card_kind !== 'change' && task.task_intent === 'discuss';
}

/**
 * The `tasks.use_worktree` value a create or update should persist. A regular
 * discuss card is always Project (`0`), even if the caller asked for a
 * worktree. Change cards ignore discuss. Work cards keep the requested
 * tri-state (`null` follows the project Worktrees switch).
 */
export function persistedUseWorktree(
  task: {
    card_kind?: TaskCardKind | null;
    task_intent?: TaskIntent | null;
  },
  requested: boolean | null | undefined,
): 0 | 1 | null {
  if (isDiscussCard(task)) return 0;
  if (requested == null) return null;
  return requested ? 1 : 0;
}
