/**
 * Work / Discuss on the task-detail edit form. New Task's create-time control
 * lives in new-task-dialog.spec.ts. These cases seed the board so a Planning
 * card and an OpenSpec change card can be opened without a UI move (Planning
 * auto-spawns on a move, and the mock's spawn throws).
 */
import { test, expect } from '@playwright/test';
import { chromium, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import { waitForViteReady, gotoVite } from './helpers';

const MOCK_SCRIPT = path.join(__dirname, 'mock-electron-api.js');
const VITE_URL = `http://localhost:${process.env.PLAYWRIGHT_VITE_PORT || '5173'}`;

const PROJECT_ID = 'proj-task-intent-edit';
const TODO_DISCUSS_ID = 'task-intent-todo-discuss';
const PLANNING_ID = 'task-intent-planning';
const CHANGE_ID = 'task-intent-change';

test.describe.configure({ mode: 'parallel' });

async function launchWithSeededState(): Promise<{ browser: Browser; page: Page }> {
  await waitForViteReady(VITE_URL);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  await page.addInitScript({ path: MOCK_SCRIPT });
  await page.addInitScript(`
    window.__mockPreConfigure(function (state) {
      var ts = new Date().toISOString();

      state.projects.push({
        id: '${PROJECT_ID}',
        name: 'Task Intent Edit',
        path: '/mock/task-intent-edit',
        github_url: null,
        default_agent: 'claude',
        last_opened: ts,
        created_at: ts,
      });

      var laneIds = {};
      state.DEFAULT_SWIMLANES.forEach(function (swimlane, index) {
        var laneId = 'lane-tie-' + swimlane.name.toLowerCase().replace(/\\s+/g, '-');
        laneIds[swimlane.name] = laneId;
        state.swimlanes.push(Object.assign({}, swimlane, {
          id: laneId,
          position: index,
          created_at: ts,
        }));
      });

      var planningLane = state.swimlanes.find(function (s) { return s.name === 'Planning'; });
      var executingLane = state.swimlanes.find(function (s) { return s.name === 'Executing'; });
      if (planningLane && executingLane) {
        planningLane.plan_exit_target_id = executingLane.id;
      }

      function taskRow(id, title, extras) {
        return Object.assign({
          id: id,
          display_id: 1,
          title: title,
          description: '',
          swimlane_id: laneIds['To Do'],
          position: 0,
          agent: null,
          session_id: null,
          worktree_path: null,
          branch_name: null,
          pr_number: null,
          pr_url: null,
          base_branch: null,
          archived_at: null,
          card_kind: 'regular',
          task_intent: 'work',
          created_at: ts,
          updated_at: ts,
        }, extras || {});
      }

      state.tasks.push(taskRow('${TODO_DISCUSS_ID}', 'Discuss To Do', {
        display_id: 1,
        position: 0,
        task_intent: 'discuss',
      }));
      state.tasks.push(taskRow('${PLANNING_ID}', 'Planning Intent Task', {
        display_id: 2,
        swimlane_id: laneIds['Planning'],
        position: 0,
      }));
      state.tasks.push(taskRow('${CHANGE_ID}', 'Change Intent Task', {
        display_id: 3,
        position: 1,
        card_kind: 'change',
        openspec_change: 'add-intent-choice',
        openspec_note: 'ready',
      }));

      return { currentProjectId: '${PROJECT_ID}' };
    });
  `);

  await gotoVite(page, VITE_URL);
  await page.waitForLoadState('load');
  await page.waitForSelector('text=Kangentic', { timeout: 15000 });

  return { browser, page };
}

async function openEditForm(page: Page, taskId: string): Promise<void> {
  await page.locator(`[data-task-id="${taskId}"]`).click();
  const dialog = page.locator('[data-testid="task-detail-dialog"]');
  await dialog.waitFor({ state: 'visible' });

  const editScroll = dialog.locator('[data-testid="task-detail-edit-scroll"]');
  await expect(dialog.locator('[data-testid="task-detail-edit-scroll"], [aria-label="Actions"]').first())
    .toBeVisible({ timeout: 5000 });
  if (await editScroll.isVisible()) return;

  await dialog.locator('[aria-label="Actions"]').click();
  const editButton = page.locator('button:has-text("Edit")').filter({ has: page.locator('.lucide-pencil') });
  await expect(editButton).toBeVisible({ timeout: 5000 });
  await editButton.click();
  await expect(editScroll).toBeVisible({ timeout: 5000 });
}

test.describe('Task intent on edit', () => {
  test('a To Do card reopens with the saved Discuss choice', async () => {
    const { browser, page } = await launchWithSeededState();

    try {
      await page.locator('[data-swimlane-name="To Do"]').waitFor({ state: 'visible', timeout: 15000 });
      await openEditForm(page, TODO_DISCUSS_ID);

      const dialog = page.locator('[data-testid="task-detail-dialog"]');
      await expect(dialog.locator('[data-testid="task-intent"]')).toBeVisible();
      await expect(dialog.getByText('How this task starts')).toBeVisible();
      await expect(dialog.locator('[data-testid="task-intent-discuss"]')).toHaveAttribute('aria-checked', 'true');
      await expect(dialog.locator('[data-testid="task-intent-work"]')).toHaveAttribute('aria-checked', 'false');
    } finally {
      await browser.close();
    }
  });

  test('a Planning card does not show Work / Discuss', async () => {
    const { browser, page } = await launchWithSeededState();

    try {
      await page.locator('[data-swimlane-name="Planning"]').waitFor({ state: 'visible', timeout: 15000 });
      await openEditForm(page, PLANNING_ID);

      const dialog = page.locator('[data-testid="task-detail-dialog"]');
      await expect(dialog.locator('[data-testid="task-detail-edit-scroll"]')).toBeVisible();
      await expect(dialog.locator('[data-testid="task-intent"]')).not.toBeVisible();
    } finally {
      await browser.close();
    }
  });

  test('an OpenSpec change card does not show Work / Discuss', async () => {
    const { browser, page } = await launchWithSeededState();

    try {
      await page.locator('[data-swimlane-name="To Do"]').waitFor({ state: 'visible', timeout: 15000 });
      await openEditForm(page, CHANGE_ID);

      const dialog = page.locator('[data-testid="task-detail-dialog"]');
      await expect(dialog.locator('[data-testid="task-detail-edit-scroll"]')).toBeVisible();
      await expect(dialog.locator('[data-testid="task-intent"]')).not.toBeVisible();
    } finally {
      await browser.close();
    }
  });
});
