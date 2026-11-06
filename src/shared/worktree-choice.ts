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
 * A discuss card in a planning column is a separate skip (`discuss-plan`):
 * `discussCardSkipsWorktreeInPlanning` is the shared predicate, and
 * `ensureTaskWorktree` records it before it would create or claim a spare.
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
 * A planning column: permission mode is `plan`, or a plan-exit target is set.
 * Covers the default seed Planning column and a custom board whose Planning
 * column is `acceptEdits` plus a plan-exit target. Not matched by column name.
 */
export function isPlanningColumn(lane: {
  permission_mode?: string | null;
  plan_exit_target_id?: string | null;
} | null | undefined): boolean {
  if (!lane) return false;
  return lane.permission_mode === 'plan' || Boolean(lane.plan_exit_target_id);
}

/**
 * A discuss card in a planning column writes OpenSpec proposals in the project
 * folder, where the default-branch scan can see them. Work and change cards
 * still get a worktree. A live worktree is reused at the call site, not here.
 */
export function discussCardSkipsWorktreeInPlanning(
  task: {
    card_kind?: TaskCardKind | null;
    task_intent?: TaskIntent | null;
  },
  lane: {
    permission_mode?: string | null;
    plan_exit_target_id?: string | null;
  } | null | undefined,
): boolean {
  return isDiscussCard(task) && isPlanningColumn(lane);
}
