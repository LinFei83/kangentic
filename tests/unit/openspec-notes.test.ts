/**
 * OpenSpec status tokens stored on `Task.openspec_note`. The scan writes the
 * token; the UI paints only a recognized one.
 */
import { describe, it, expect } from 'vitest';
import { englishText } from '../../src/shared/i18n/english';
import {
  OPENSPEC_ARCHIVE_COMMAND,
  OPENSPEC_EXPLORE_COMMAND,
  OPENSPEC_PROPOSE_DEFAULT_BRANCH_NOTE,
} from '../../src/shared/openspec-commands';
import { openspecNoteDescriptor } from '../../src/shared/openspec-notes';

describe('openspecNoteDescriptor', () => {
  it('returns null for a missing, blank or unknown token', () => {
    expect(openspecNoteDescriptor(null)).toBeNull();
    expect(openspecNoteDescriptor(undefined)).toBeNull();
    expect(openspecNoteDescriptor('')).toBeNull();
    expect(openspecNoteDescriptor('ready ')).toBeNull();
    expect(openspecNoteDescriptor('Validation did not pass')).toBeNull();
    expect(openspecNoteDescriptor('tasks:3')).toBeNull();
    expect(openspecNoteDescriptor('tasks:a/b')).toBeNull();
  });

  it('resolves each known token to its English copy', () => {
    expect(englishText(openspecNoteDescriptor('ready')!)).toBe('Ready');
    expect(englishText(openspecNoteDescriptor('archived')!)).toBe('Archived');
    expect(englishText(openspecNoteDescriptor('invalid')!)).toBe('Validation did not pass');
    expect(englishText(openspecNoteDescriptor('missing')!)).toBe('OpenSpec CLI was not found');
    expect(englishText(openspecNoteDescriptor('error')!)).toBe('Could not check');
  });

  it('renders a tasks:n/n token as the fraction only', () => {
    expect(englishText(openspecNoteDescriptor('tasks:3/12')!)).toBe('3/12');
    expect(englishText(openspecNoteDescriptor('tasks:0/0')!)).toBe('0/0');
    expect(englishText(openspecNoteDescriptor('tasks:12/3')!)).toBe('12/3');
  });
});

describe('OPENSPEC_EXPLORE_COMMAND', () => {
  it('is the Cursor form, not the canonical colon form', () => {
    expect(OPENSPEC_EXPLORE_COMMAND).toBe('/opsx-explore');
    expect(OPENSPEC_ARCHIVE_COMMAND).toBe('/opsx-archive');
    expect(OPENSPEC_PROPOSE_DEFAULT_BRANCH_NOTE).toContain('default branch');
  });
});
