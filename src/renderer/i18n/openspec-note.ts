/**
 * Renderer copy for an OpenSpec change card: the type-badge tip and the compact
 * status line. Token parsing stays in `openspecNoteDescriptor`; this file only
 * turns a recognized descriptor into the session's language.
 */
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/runtime-macro';
import { openspecNoteDescriptor } from '../../shared/openspec-notes';
import { translateText } from './translate';

/** The translated status sentence, or null when the token is missing or unknown. */
export function openspecNoteLabel(note: string | null | undefined): string | null {
  const descriptor = openspecNoteDescriptor(note);
  return descriptor ? translateText(descriptor) : null;
}

/** Hover text on the ScrollText type badge. */
export function openspecChangeTip(name: string): string {
  return i18n._(msg`OpenSpec change: ${{ name }}`);
}

/**
 * Compact-card second tooltip line: the change name, then the note.
 * A tasks token keeps the word "tasks" after the fraction
 * (`add-rate-limiting. 3/12 tasks`); other tokens use the translated sentence.
 * The kind check is prefix-only. The numbers still come from the shared descriptor.
 */
export function openspecCompactStatusLine(name: string, note: string | null | undefined): string | null {
  const status = openspecNoteLabel(note);
  if (status === null) return null;
  if (typeof note === 'string' && note.startsWith('tasks:')) {
    return i18n._(msg`${{ name }}. ${{ status }} tasks`);
  }
  return i18n._(msg`${{ name }}. ${{ status }}`);
}

export function isOpenspecArchivedNote(note: string | null | undefined): boolean {
  return note === 'archived';
}
