/**
 * OpenSpec change-card status tokens stored on `Task.openspec_note`.
 *
 * The scan writes only these stable tokens, never a sentence. The UI turns a
 * recognized token into a Lingui descriptor and leaves an unknown one unpainted.
 */
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/runtime-macro';

const TASKS_PROGRESS = /^tasks:(\d+)\/(\d+)$/;

const READY = msg({ message: 'Ready', context: 'OpenSpec change status' });
const ARCHIVED = msg({ message: 'Archived', context: 'OpenSpec change status' });
const INVALID = msg`Validation did not pass`;
const MISSING = msg`OpenSpec CLI was not found`;
const ERROR = msg`Could not check`;
const TASKS_PROGRESS_MESSAGE = msg({ message: '{done}/{total}', context: 'OpenSpec tasks progress' });

/**
 * The UI copy for a stored OpenSpec note token, or null when the token is
 * missing or unrecognized. Wave 1D paints null as no status text.
 */
export function openspecNoteDescriptor(note: string | null | undefined): MessageDescriptor | null {
  if (typeof note !== 'string' || note.length === 0) return null;
  if (note === 'ready') return READY;
  if (note === 'archived') return ARCHIVED;
  if (note === 'invalid') return INVALID;
  if (note === 'missing') return MISSING;
  if (note === 'error') return ERROR;
  const tasksMatch = TASKS_PROGRESS.exec(note);
  if (tasksMatch) {
    return { ...TASKS_PROGRESS_MESSAGE, values: { done: tasksMatch[1], total: tasksMatch[2] } };
  }
  return null;
}
