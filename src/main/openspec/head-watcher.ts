/**
 * Git-metadata watch for the OpenSpec scan, wrapped around DiffWatcher's
 * pattern (`src/main/git/diff-watcher.ts`) without its working-tree watch.
 *
 * Local saves must not trigger a scan. The object is `openspec/changes/`
 * committed on the default branch, so this watches `.git/HEAD`, `packed-refs`,
 * and `logs/HEAD` (commits move logs/HEAD even when HEAD still names the same
 * branch). It does not watch `index` or the working tree, and it does not
 * change Changes-panel subscribers on the shared DiffWatcher.
 *
 * Handles are released by `unsubscribe` / `releaseUnder` / `closeAll`. The
 * scheduler stops on project switch, delete, relocate, and shutdown so a
 * Windows `fs.watch` on a deleted git dir cannot spin.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openSimpleGit } from '../git/simple-git-client';
import { replacePathPrefix } from '../../shared/paths';

const DEBOUNCE_MS = 500;
const MAX_DEBOUNCE_WAIT_MS = 2000;
const GIT_META_FILES = new Set(['HEAD', 'packed-refs']);

interface WatcherEntry {
  watchers: fs.FSWatcher[];
  debounceTimer: ReturnType<typeof setTimeout> | null;
  pendingSince: number;
  callbacks: Set<() => void>;
}

class OpenspecHeadWatcher {
  private readonly watchers = new Map<string, WatcherEntry>();
  private readonly gitDirCache = new Map<string, string>();

  subscribe(projectPath: string, callback: () => void): () => void {
    const existing = this.watchers.get(projectPath);
    if (existing) {
      existing.callbacks.add(callback);
      return () => this.removeCallback(projectPath, callback);
    }

    const entry: WatcherEntry = {
      watchers: [],
      debounceTimer: null,
      pendingSince: 0,
      callbacks: new Set([callback]),
    };
    this.watchers.set(projectPath, entry);

    const dispatch = () => {
      for (const registeredCallback of entry.callbacks) registeredCallback();
    };

    const fire = () => {
      const current = this.watchers.get(projectPath);
      if (current !== entry) return;

      const now = Date.now();
      if (entry.debounceTimer === null) {
        entry.pendingSince = now;
      } else {
        clearTimeout(entry.debounceTimer);
        if (now - entry.pendingSince >= MAX_DEBOUNCE_WAIT_MS) {
          entry.debounceTimer = null;
          dispatch();
          return;
        }
      }

      entry.debounceTimer = setTimeout(() => {
        entry.debounceTimer = null;
        dispatch();
      }, DEBOUNCE_MS);
    };

    this.watchGitMetadata(projectPath, entry, fire);
    return () => this.removeCallback(projectPath, callback);
  }

  private removeCallback(projectPath: string, callback: () => void): void {
    const entry = this.watchers.get(projectPath);
    if (!entry) return;
    entry.callbacks.delete(callback);
    if (entry.callbacks.size === 0) this.unsubscribe(projectPath);
  }

  private watchGitMetadata(projectPath: string, entry: WatcherEntry, fire: () => void): void {
    const cachedGitDir = this.gitDirCache.get(projectPath);
    if (cachedGitDir !== undefined) {
      this.armGitMetadataWatches(projectPath, cachedGitDir, entry, fire);
      return;
    }

    openSimpleGit(projectPath)
      .raw(['rev-parse', '--absolute-git-dir'])
      .then((output) => {
        const gitDir = output.trim();
        if (!gitDir) return;
        if (this.watchers.get(projectPath) !== entry) return;
        this.gitDirCache.set(projectPath, gitDir);
        this.armGitMetadataWatches(projectPath, gitDir, entry, fire);
      })
      .catch(() => {
        // Not a git repo, or git unavailable. The next project open retries.
      });
  }

  private armGitMetadataWatches(
    projectPath: string,
    gitDir: string,
    entry: WatcherEntry,
    fire: () => void,
  ): void {
    if (this.watchers.get(projectPath) !== entry) return;

    try {
      const metaWatcher = fs.watch(gitDir, { recursive: false }, (_eventType, filename) => {
        if (filename && GIT_META_FILES.has(path.basename(filename.toString()))) fire();
      });
      entry.watchers.push(metaWatcher);
    } catch {
      // A missing watch must not break the rest.
    }

    const logsDir = path.join(gitDir, 'logs');
    if (fs.existsSync(logsDir)) {
      try {
        const logsWatcher = fs.watch(logsDir, { recursive: false }, (_eventType, filename) => {
          if (filename && path.basename(filename.toString()) === 'HEAD') fire();
        });
        entry.watchers.push(logsWatcher);
      } catch {
        // ignore
      }
    }
  }

  unsubscribe(projectPath: string): void {
    const entry = this.watchers.get(projectPath);
    if (!entry) return;

    if (entry.debounceTimer !== null) {
      clearTimeout(entry.debounceTimer);
    }
    for (const watcher of entry.watchers) {
      try {
        watcher.close();
      } catch {
        // Closing an already-dead watcher is harmless.
      }
    }
    this.watchers.delete(projectPath);
  }

  releaseUnder(pathPrefix: string): void {
    for (const projectPath of [...this.watchers.keys()]) {
      if (replacePathPrefix(projectPath, pathPrefix, pathPrefix) !== null) {
        this.unsubscribe(projectPath);
      }
    }
    for (const projectPath of [...this.gitDirCache.keys()]) {
      if (replacePathPrefix(projectPath, pathPrefix, pathPrefix) !== null) {
        this.gitDirCache.delete(projectPath);
      }
    }
  }

  closeAll(): void {
    for (const [projectPath] of this.watchers) {
      this.unsubscribe(projectPath);
    }
  }
}

export const openspecHeadWatcher = new OpenspecHeadWatcher();
