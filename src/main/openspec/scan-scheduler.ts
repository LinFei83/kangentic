/**
 * Per-project OpenSpec change scan. Kangentic has one focused project at a
 * time, so this keeps a single active run: opening a project scans once, git
 * metadata on `project.path` scans again, and switching away or closing
 * tears it down.
 *
 * Lifecycle matches `src/main/pr/pr-refresh-scheduler.ts`: `startForProject`
 * / `stop`, hooked from `handlers/projects.ts`, stopped on shutdown. The
 * first scan is deferred off PROJECT_OPEN. Timers and watches are cleared on
 * switch, delete, relocate, and quit.
 *
 * A scan starts with `git rev-parse <defaultBranch>:openspec/changes`. An
 * unchanged tree SHA returns without listing or evaluating.
 */
import { runWithProjectLogContext } from '../diagnostics/project-log-context';
import { isShuttingDown } from '../shutdown-state';
import type { IpcContext } from '../ipc/ipc-context';
import type { Project } from '../../shared/types';
import { openspecHeadWatcher } from './head-watcher';
import { scanOpenspecChangesForProject } from './scan';

let activeProjectId: string | null = null;
let activeProjectPath: string | null = null;
let unsubscribeHead: (() => void) | null = null;
let lastTreeSha: string | null = null;
let generation = 0;
let scanInFlight = false;
let scanAgain = false;

function isActive(context: IpcContext, project: Project): boolean {
  return activeProjectId === project.id && context.currentProjectId === project.id;
}

async function runScan(context: IpcContext, project: Project, sweepGeneration: number): Promise<void> {
  if (generation !== sweepGeneration || !isActive(context, project) || isShuttingDown()) return;
  if (scanInFlight) {
    scanAgain = true;
    return;
  }
  scanInFlight = true;
  try {
    do {
      scanAgain = false;
      const result = await runWithProjectLogContext(project.name, () => (
        scanOpenspecChangesForProject(context, project, lastTreeSha)
      ));
      if (generation !== sweepGeneration || !isActive(context, project)) return;
      lastTreeSha = result.treeSha;
    } while (scanAgain && generation === sweepGeneration && isActive(context, project) && !isShuttingDown());
  } catch (error: unknown) {
    console.error('[openspec-scan] scan failed:', error);
  } finally {
    scanInFlight = false;
  }
}

export const openspecScanScheduler = {
  /**
   * Scan `project` once and watch its main-repo git metadata. Called on every
   * PROJECT_OPEN (cold restart and warm switch-back). Synchronous-cheap: the
   * scan is deferred off the IPC critical path.
   */
  startForProject(context: IpcContext, project: Project): void {
    openspecScanScheduler.stop();
    activeProjectId = project.id;
    activeProjectPath = project.path;
    lastTreeSha = null;
    const startGeneration = generation;

    setImmediate(() => {
      void runScan(context, project, startGeneration);
    });

    unsubscribeHead = openspecHeadWatcher.subscribe(project.path, () => {
      void runScan(context, project, startGeneration);
    });
  },

  /**
   * Stop the active scan and its HEAD watch. With a `projectId`, no-ops
   * unless that project owns it. With no argument, always stops.
   */
  stop(projectId?: string): void {
    if (projectId != null && projectId !== activeProjectId) return;
    generation += 1;
    scanAgain = false;
    if (unsubscribeHead) {
      unsubscribeHead();
      unsubscribeHead = null;
    }
    if (activeProjectPath) {
      openspecHeadWatcher.releaseUnder(activeProjectPath);
      activeProjectPath = null;
    }
    activeProjectId = null;
    lastTreeSha = null;
  },
};
