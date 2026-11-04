/**
 * UI tests for OpenSpec change-card chrome: the ScrollText type badge, the
 * extra left accent edge, and `openspec_note` status on the title row.
 *
 * Intent: a change card is the same skeleton as a regular card, with a light
 * distinction. Compact density (and the Done completed list) hide the status
 * text and fold it into the badge tooltip's second line. The task-detail
 * header shows the same badge plus the translated sentence.
 *
 * Fixture tokens stand in for the Wave 1B scanner.
 */
import { test, expect } from '@playwright/test';
import { chromium, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import { waitForViteReady, gotoVite } from './helpers';

const MOCK_SCRIPT = path.join(__dirname, 'mock-electron-api.js');
const VITE_URL = `http://localhost:${process.env.PLAYWRIGHT_VITE_PORT || '5173'}`;

const PROJECT_ID = 'proj-openspec-card';
const REGULAR_ID = 'task-openspec-regular';
const TASKS_ID = 'task-openspec-tasks';
const ARCHIVED_NOTE_ID = 'task-openspec-archived-note';
const UNKNOWN_ID = 'task-openspec-unknown';
const NULL_NOTE_ID = 'task-openspec-null';
const COMPACT_ID = 'task-openspec-compact';
const CHANGE_NAME = 'add-rate-limiting';
const ARCHIVED_CHANGE_NAME = 'retired-feature';

async function launchWithState(preConfigScript: string): Promise<{ browser: Browser; page: Page }> {
  await waitForViteReady(VITE_URL);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  await page.addInitScript({ path: MOCK_SCRIPT });
  await page.addInitScript(preConfigScript);

  await gotoVite(page, VITE_URL);
  await page.waitForLoadState('load');
  await page.waitForSelector('text=Kangentic', { timeout: 15000 });

  return { browser, page };
}

const preConfig = `
  window.__mockPreConfigure(function (state) {
    var timestamp = new Date().toISOString();

    state.projects.push({
      id: '${PROJECT_ID}',
      name: 'OpenSpec Card Test',
      path: '/mock/openspec-card-test',
      github_url: null,
      default_agent: 'claude',
      last_opened: timestamp,
      created_at: timestamp,
    });

    var laneIds = {};
    state.DEFAULT_SWIMLANES.forEach(function (swimlane, index) {
      var id = 'lane-osc-' + swimlane.name.toLowerCase().replace(/\\s+/g, '-');
      laneIds[swimlane.name] = id;
      state.swimlanes.push(Object.assign({}, swimlane, { id: id, position: index, created_at: timestamp }));
    });

    function changeCard(id, title, note, extras) {
      return Object.assign({
        id: id,
        display_id: 1,
        title: title,
        description: 'Change card fixture',
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
        card_kind: 'change',
        task_intent: 'work',
        openspec_change: '${CHANGE_NAME}',
        openspec_note: note,
        created_at: timestamp,
        updated_at: timestamp,
      }, extras || {});
    }

    state.tasks.push({
      id: '${REGULAR_ID}',
      display_id: 10,
      title: 'Regular work card',
      description: 'Not an OpenSpec change',
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
      created_at: timestamp,
      updated_at: timestamp,
    });
    state.tasks.push(changeCard('${TASKS_ID}', 'Rate limiting change', 'tasks:3/12', { display_id: 11, position: 1 }));
    state.tasks.push(changeCard('${ARCHIVED_NOTE_ID}', 'Archived change', 'archived', {
      display_id: 12,
      position: 2,
      openspec_change: '${ARCHIVED_CHANGE_NAME}',
    }));
    state.tasks.push(changeCard('${UNKNOWN_ID}', 'Unknown note change', 'not-a-token', { display_id: 13, position: 3 }));
    state.tasks.push(changeCard('${NULL_NOTE_ID}', 'Unstamped change', null, { display_id: 14, position: 4 }));

    state.archivedTasks.push(changeCard('${COMPACT_ID}', 'Compact change', 'tasks:3/12', {
      display_id: 99,
      swimlane_id: laneIds['Done'],
      archived_at: timestamp,
    }));

    return { currentProjectId: '${PROJECT_ID}' };
  });
`;

async function updateConfig(page: Page, partial: Record<string, string>): Promise<void> {
  await page.evaluate((value) => {
    const stores = (window as unknown as {
      __zustandStores?: { config: { getState: () => { updateConfig: (partial: Record<string, string>) => Promise<void> } } };
    }).__zustandStores;
    return stores?.config.getState().updateConfig(value);
  }, partial);
}

async function openTaskDetail(page: Page, taskId: string): Promise<void> {
  await page.evaluate((id) => {
    const stores = (window as unknown as {
      __zustandStores?: { session: { getState: () => { setDetailTaskId: (taskId: string) => void } } };
    }).__zustandStores;
    stores?.session.getState().setDetailTaskId(id);
  }, taskId);
}

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  const result = await launchWithState(preConfig);
  browser = result.browser;
  page = result.page;
  await page.locator('[data-swimlane-name="To Do"]').waitFor({ state: 'visible', timeout: 15000 });
});

test.afterAll(async () => {
  await browser?.close();
});

test.describe('OpenSpec change-card chrome', () => {
  test('a regular card has no type badge, status, or accent edge', async () => {
    const card = page.locator(`[data-task-id="${REGULAR_ID}"]`);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-card-kind', 'regular');
    await expect(card.locator('[data-testid="openspec-change-badge"]')).toHaveCount(0);
    await expect(card.locator('[data-testid="openspec-note"]')).toHaveCount(0);
    await expect(card).not.toHaveClass(/border-l-accent/);
  });

  test('a change card draws the badge, accent edge, and tasks note', async () => {
    const card = page.locator(`[data-task-id="${TASKS_ID}"]`);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-card-kind', 'change');
    await expect(card).toHaveClass(/border-l-accent/);

    const badge = card.locator('[data-testid="openspec-change-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('aria-label', CHANGE_NAME);
    await expect(badge).toHaveAccessibleDescription(`OpenSpec change: ${CHANGE_NAME}`);

    const note = card.locator('[data-testid="openspec-note"]');
    await expect(note).toBeVisible();
    await expect(note).toHaveText('3/12');
    await expect(note).toHaveClass(/text-fg-muted/);
    await expect(card.getByTestId('task-card-description')).toHaveText('Change card fixture');
  });

  test('an archived note uses the faint tone', async () => {
    const card = page.locator(`[data-task-id="${ARCHIVED_NOTE_ID}"]`);
    const note = card.locator('[data-testid="openspec-note"]');
    await expect(note).toHaveText('Archived');
    await expect(note).toHaveClass(/text-fg-faint/);
  });

  test('an unknown or missing note still draws the badge and skips the status', async () => {
    const unknown = page.locator(`[data-task-id="${UNKNOWN_ID}"]`);
    await expect(unknown.locator('[data-testid="openspec-change-badge"]')).toBeVisible();
    await expect(unknown.locator('[data-testid="openspec-note"]')).toHaveCount(0);

    const unstamped = page.locator(`[data-task-id="${NULL_NOTE_ID}"]`);
    await expect(unstamped.locator('[data-testid="openspec-change-badge"]')).toBeVisible();
    await expect(unstamped.locator('[data-testid="openspec-note"]')).toHaveCount(0);
  });

  test('compact density hides the status and folds it into the badge tooltip', async () => {
    const card = page.locator(`[data-task-id="${TASKS_ID}"]`);
    await updateConfig(page, { cardDensity: 'compact' });

    await expect(card.locator('[data-testid="openspec-note"]')).toHaveCount(0);
    const badge = card.locator('[data-testid="openspec-change-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAccessibleDescription(
      `OpenSpec change: ${CHANGE_NAME}\n${CHANGE_NAME}. 3/12 tasks`,
    );

    await updateConfig(page, { cardDensity: 'default' });
    await expect(card.locator('[data-testid="openspec-note"]')).toHaveText('3/12');
  });

  test('a compact Done card puts status in the badge tooltip', async () => {
    const compactCard = page.locator(`[data-task-id="${COMPACT_ID}"]`);
    await expect(compactCard.locator('[data-testid="compact-title"]')).toBeVisible({ timeout: 5000 });
    await expect(compactCard).toHaveClass(/border-l-accent/);
    await expect(compactCard.locator('[data-testid="openspec-note"]')).toHaveCount(0);

    const badge = compactCard.locator('[data-testid="openspec-change-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAccessibleDescription(
      `OpenSpec change: ${CHANGE_NAME}\n${CHANGE_NAME}. 3/12 tasks`,
    );
  });

  test('the task-detail header shows the badge and translated sentence', async () => {
    await openTaskDetail(page, TASKS_ID);
    const dialog = page.locator('[data-testid="task-detail-dialog"]');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });

    const badge = dialog.locator('[data-testid="task-detail-openspec-badge"]');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('aria-label', CHANGE_NAME);
    await expect(badge).toHaveAccessibleDescription(`OpenSpec change: ${CHANGE_NAME}`);

    const note = dialog.locator('[data-testid="task-detail-openspec-note"]');
    await expect(note).toBeVisible();
    await expect(note).toHaveText('3/12');
  });
});
