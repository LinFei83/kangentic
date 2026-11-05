/**
 * Unit tests for CursorSessionHistoryParser: Prompt on a displayed user
 * line, Idle on `turn_ended`, nothing from assistant or injected-context
 * user lines. Locate polls the already-tested transcript path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EventType } from '../../src/shared/types';

const mockLocateCursorTranscriptFile = vi.fn();

vi.mock('../../src/main/agent/adapters/cursor/session-paths', () => ({
  locateCursorTranscriptFile: (...args: unknown[]) => mockLocateCursorTranscriptFile(...args),
}));

const { CursorSessionHistoryParser } = await import(
  '../../src/main/agent/adapters/cursor/session-history-parser'
);

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'cursor-agent-transcript.jsonl');
const SESSION_ID = 'c6b62c6f-7ead-4fd6-9922-e952131177ff';
const CWD = '/projects/foo';

function userLine(text: string): string {
  return JSON.stringify({
    role: 'user',
    message: { content: [{ type: 'text', text }] },
  });
}

function assistantLine(text: string): string {
  return JSON.stringify({
    role: 'assistant',
    message: { content: [{ type: 'text', text }] },
  });
}

describe('CursorSessionHistoryParser.parse', () => {
  it('emits Prompt then Idle from the committed agent-transcripts fixture', () => {
    const content = fs.readFileSync(FIXTURE_PATH, 'utf-8');
    const result = CursorSessionHistoryParser.parse(content, 'full');

    expect(result.usage).toBeNull();
    expect(result.activity).toBeNull();
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      type: EventType.Prompt,
      detail: 'Call the kangentic_search tool once with mode "hybrid" and query "release checklist". Then reply in one sentence.',
    });
    expect(result.events[1]).toMatchObject({ type: EventType.Idle });
  });

  it('skips assistant lines so stream-json tool events are not double-counted', () => {
    const content = [
      userLine('<user_query>\nFix the bug.\n</user_query>'),
      assistantLine('Looking now.'),
      JSON.stringify({ type: 'turn_ended', status: 'success' }),
    ].join('\n');
    const result = CursorSessionHistoryParser.parse(content, 'append');

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({ type: EventType.Prompt, detail: 'Fix the bug.' });
    expect(result.events[1]).toMatchObject({ type: EventType.Idle });
  });

  it('skips injected-context user lines that are not a turn', () => {
    const content = userLine('<available_subagent_types>\ngeneralPurpose\n</available_subagent_types>');
    const result = CursorSessionHistoryParser.parse(content, 'append');
    expect(result.events).toEqual([]);
  });

  it('skips malformed lines without throwing', () => {
    const content = [
      '{this is not json}',
      userLine('<user_query>\nHello.\n</user_query>'),
      '{"type":"turn_ended"',
      JSON.stringify({ type: 'turn_ended', status: 'error' }),
    ].join('\n');
    const result = CursorSessionHistoryParser.parse(content, 'append');
    expect(result.events.map((event) => event.type)).toEqual([EventType.Prompt, EventType.Idle]);
  });

  it('returns no events for empty content', () => {
    const result = CursorSessionHistoryParser.parse('', 'full');
    expect(result).toEqual({ usage: null, events: [], activity: null });
  });
});

describe('CursorSessionHistoryParser.locate', () => {
  beforeEach(() => {
    mockLocateCursorTranscriptFile.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the transcript path on the first attempt when the file is already present', async () => {
    const located = `/home/dev/.cursor/projects/projects-foo/agent-transcripts/${SESSION_ID}/${SESSION_ID}.jsonl`;
    mockLocateCursorTranscriptFile.mockResolvedValue(located);

    const resultPromise = CursorSessionHistoryParser.locate({
      agentSessionId: SESSION_ID,
      cwd: CWD,
    });
    await vi.runAllTimersAsync();

    expect(await resultPromise).toBe(located);
    expect(mockLocateCursorTranscriptFile).toHaveBeenCalledTimes(1);
  });

  it('polls until the file appears', async () => {
    const located = `/home/dev/.cursor/projects/projects-foo/agent-transcripts/${SESSION_ID}/${SESSION_ID}.jsonl`;
    mockLocateCursorTranscriptFile
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(located);

    const resultPromise = CursorSessionHistoryParser.locate({
      agentSessionId: SESSION_ID,
      cwd: CWD,
    });
    await vi.runAllTimersAsync();

    expect(await resultPromise).toBe(located);
    expect(mockLocateCursorTranscriptFile).toHaveBeenCalledTimes(3);
  });
});
