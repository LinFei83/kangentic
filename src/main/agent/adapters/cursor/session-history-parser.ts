import {
  EventType,
  type SessionEvent,
  type SessionHistoryParseResult,
  type StoredCliTarget,
} from '../../../../shared/types';
import { placeFromStored } from '../../shared/cli-target';
import { locateCursorTranscriptFile } from './session-paths';
import { cursorDisplayedUserText } from './transcript-parser';

/**
 * Live-telemetry parser for Cursor CLI's `agent-transcripts` JSONL.
 *
 * `~/.cursor/projects/<slug>/agent-transcripts/<sessionId>/<sessionId>.jsonl`
 *
 * Cursor has no hooks Kangentic wires, so this file is what says a turn
 * started and ended. A user line with displayed text is a Prompt (starts
 * the turn and, through ingestEvents, turns the PTY silence timer off
 * before it can idle a still-running turn). `{ type: "turn_ended" }` is
 * an Idle, the same shape a Stop hook uses, so `onTurnEnded` runs the
 * column's On agent turn end automations.
 *
 * Tool starts and ends stay with `--output-format stream-json` on the
 * print path. Emitting them here as well would double-count and wedge
 * the session at thinking. Interactive TUI sessions print no stream-json,
 * so the Prompt plus turn_ended pair is the whole activity picture.
 *
 * The session id is known at spawn for an interactive start (`create-chat`)
 * and captured from the init event on a print start, both before this
 * file exists. `create-chat` writes nothing until the first turn, so
 * locate polls for about 60 s, the same budget Claude uses for a
 * spawn-time attach. A WSL Cursor keeps the file under that distro's
 * home (`placeFromStored`).
 *
 * Append-only JSONL. Resume appends to the same file. No timestamps in
 * the records, so events use Date.now().
 */
export class CursorSessionHistoryParser {
  static async locate(options: {
    agentSessionId: string;
    cwd: string;
    cliTarget?: StoredCliTarget | null;
  }): Promise<string | null> {
    const place = placeFromStored(options.cliTarget ?? null);
    const maxAttempts = 120; // 120 x 500ms = ~60s
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const filePath = await locateCursorTranscriptFile(
        options.agentSessionId,
        options.cwd,
        place,
      );
      if (filePath) return filePath;
      await sleep(500);
    }
    return null;
  }

  static parse(content: string, _mode: 'full' | 'append'): SessionHistoryParseResult {
    const events: SessionEvent[] = [];

    for (const line of content.split(/\r?\n/)) {
      if (line.length === 0) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(raw)) continue;

      if (raw.type === 'turn_ended') {
        events.push({ ts: Date.now(), type: EventType.Idle });
        continue;
      }

      if (raw.role !== 'user' || !isRecord(raw.message)) continue;
      const text = cursorDisplayedUserText(extractText(raw.message.content));
      if (!text) continue;
      events.push({ ts: Date.now(), type: EventType.Prompt, detail: text });
    }

    return { usage: null, events, activity: null };
  }
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
