// The entry page note editor's rules (EntryNote.svelte stays thin).

import { NOTE_MAX_CHARS, noteChars, normalizeNoteText } from './notes';

export type NoteView = 'loading' | 'empty' | 'show' | 'edit' | 'confirmDelete' | 'error';

function charsOf(draft: string): number {
	const save = normalizeNoteText(draft);
	if (save.kind === 'delete') return 0;
	if (save.kind === 'tooLong') return save.chars;
	return noteChars(save.text);
}

/** counterText is "n / 2000", n counted after normalising. */
export function counterText(draft: string): string {
	return `${charsOf(draft)} / ${NOTE_MAX_CHARS}`;
}

export function isOverCap(draft: string): boolean {
	return charsOf(draft) > NOTE_MAX_CHARS;
}

/** canSave: the draft fits and changes the saved note (blank deletes an existing one). */
export function canSave(draft: string, saved: string | null): boolean {
	const save = normalizeNoteText(draft);
	if (save.kind === 'tooLong') return false;
	if (save.kind === 'delete') return saved !== null;
	return save.text !== saved;
}
