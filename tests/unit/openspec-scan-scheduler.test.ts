/**
 * OpenSpec scan scheduler: deferred first scan on start, HEAD-watch callback,
 * stop() teardown, and the projectId-scoped stop no-op. Mirrors
 * tests/unit/pr-refresh-scheduler.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IpcContext } from '../../src/main/ipc/ipc-context';
import type { Project } from '../../src/shared/types';

vi.mock('../../src/main/diagnostics/project-log-context', () => ({
  runWithProjectLogContext: <T>(_name: string, fn: () => T): T => fn(),
}));

vi.mock('../../src/main/shutdown-state', () => ({
  isShuttingDown: vi.fn(() => false),
}));

const scanForProject = vi.fn(async () => ({
  treeSha: 'tree-aaa',
  skipped: false,
  created: [] as string[],
  updated: [] as string[],
}));

vi.mock('../../src/main/openspec/scan', () => ({
  scanOpenspecChangesForProject: (...args: unknown[]) => scanForProject(...args),
}));

const headCallbacks: Array<() => void> = [];
const unsubscribe = vi.fn();
const releaseUnder = vi.fn();

vi.mock('../../src/main/openspec/head-watcher', () => ({
  openspecHeadWatcher: {
    subscribe: vi.fn((_path: string, callback: () => void) => {
      headCallbacks.push(callback);
      return unsubscribe;
    }),
    releaseUnder: (...args: unknown[]) => releaseUnder(...args),
    closeAll: vi.fn(),
    unsubscribe: vi.fn(),
  },
}));

import { openspecScanScheduler } from '../../src/main/openspec/scan-scheduler';
import { openspecHeadWatcher } from '../../src/main/openspec/head-watcher';

function makeContext(currentProjectId: string): IpcContext {
  return { currentProjectId } as IpcContext;
}

function makeProject(id: string): Project {
  return { id, path: `/mock/repo/${id}`, name: id } as Project;
}

describe('openspecScanScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    headCallbacks.length = 0;
    scanForProject.mockResolvedValue({
      treeSha: 'tree-aaa',
      skipped: false,
      created: [],
      updated: [],
    });
  });

  afterEach(() => {
    openspecScanScheduler.stop();
    vi.useRealTimers();
  });

  it('scans once on start, deferred off the caller', async () => {
    openspecScanScheduler.startForProject(makeContext('p1'), makeProject('p1'));
    expect(scanForProject).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(scanForProject).toHaveBeenCalledTimes(1);
    expect(scanForProject).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'p1' }), null);
    expect(openspecHeadWatcher.subscribe).toHaveBeenCalledWith('/mock/repo/p1', expect.any(Function));
  });

  it('scans again when git metadata fires, passing the last tree SHA', async () => {
    openspecScanScheduler.startForProject(makeContext('p1'), makeProject('p1'));
    await vi.advanceTimersByTimeAsync(0);
    expect(headCallbacks).toHaveLength(1);
    headCallbacks[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(scanForProject).toHaveBeenCalledTimes(2);
    expect(scanForProject.mock.calls[1][2]).toBe('tree-aaa');
  });

  it('does not scan after stop, and a scoped stop of another project is a no-op', async () => {
    openspecScanScheduler.startForProject(makeContext('p1'), makeProject('p1'));
    openspecScanScheduler.stop('other');
    await vi.advanceTimersByTimeAsync(0);
    expect(scanForProject).toHaveBeenCalledTimes(1);

    openspecScanScheduler.stop('p1');
    expect(unsubscribe).toHaveBeenCalled();
    expect(releaseUnder).toHaveBeenCalledWith('/mock/repo/p1');
    const callsAfterStop = scanForProject.mock.calls.length;
    if (headCallbacks[0]) headCallbacks[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(scanForProject).toHaveBeenCalledTimes(callsAfterStop);
  });

  it('skips a scan once the project is no longer current', async () => {
    const context = makeContext('p1');
    openspecScanScheduler.startForProject(context, makeProject('p1'));
    context.currentProjectId = 'p2';
    await vi.advanceTimersByTimeAsync(0);
    expect(scanForProject).not.toHaveBeenCalled();
  });
});
