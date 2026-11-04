/**
 * Renderer copy for OpenSpec change-card notes. Token parsing stays in
 * `openspecNoteDescriptor`; these helpers only translate a recognized token
 * and build the compact tooltip line.
 */
import { describe, it, expect } from 'vitest';
import {
  isOpenspecArchivedNote,
  openspecChangeTip,
  openspecCompactStatusLine,
  openspecNoteLabel,
} from '../../src/renderer/i18n/openspec-note';

describe('openspecNoteLabel', () => {
  it('returns null for a missing, blank or unknown token', () => {
    expect(openspecNoteLabel(null)).toBeNull();
    expect(openspecNoteLabel(undefined)).toBeNull();
    expect(openspecNoteLabel('')).toBeNull();
    expect(openspecNoteLabel('not-a-token')).toBeNull();
  });

  it('translates each known token', () => {
    expect(openspecNoteLabel('ready')).toBe('Ready');
    expect(openspecNoteLabel('archived')).toBe('Archived');
    expect(openspecNoteLabel('invalid')).toBe('Validation did not pass');
    expect(openspecNoteLabel('missing')).toBe('OpenSpec CLI was not found');
    expect(openspecNoteLabel('error')).toBe('Could not check');
    expect(openspecNoteLabel('tasks:3/12')).toBe('3/12');
  });
});

describe('openspecChangeTip', () => {
  it('names the change in the type-badge tip', () => {
    expect(openspecChangeTip('add-rate-limiting')).toBe('OpenSpec change: add-rate-limiting');
  });
});

describe('openspecCompactStatusLine', () => {
  it('returns null when the token is unknown', () => {
    expect(openspecCompactStatusLine('add-rate-limiting', null)).toBeNull();
    expect(openspecCompactStatusLine('add-rate-limiting', 'nope')).toBeNull();
  });

  it('keeps the word tasks after a progress fraction', () => {
    expect(openspecCompactStatusLine('add-rate-limiting', 'tasks:3/12'))
      .toBe('add-rate-limiting. 3/12 tasks');
  });

  it('uses the translated sentence for other tokens', () => {
    expect(openspecCompactStatusLine('add-rate-limiting', 'ready'))
      .toBe('add-rate-limiting. Ready');
    expect(openspecCompactStatusLine('add-rate-limiting', 'archived'))
      .toBe('add-rate-limiting. Archived');
    expect(openspecCompactStatusLine('add-rate-limiting', 'invalid'))
      .toBe('add-rate-limiting. Validation did not pass');
  });
});

describe('isOpenspecArchivedNote', () => {
  it('is true only for the archived token', () => {
    expect(isOpenspecArchivedNote('archived')).toBe(true);
    expect(isOpenspecArchivedNote('ready')).toBe(false);
    expect(isOpenspecArchivedNote(null)).toBe(false);
  });
});
