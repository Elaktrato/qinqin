import { forgetEntryBases } from './entryBases';
import { api } from './client';
import type { Entry, EntryDetail } from './types';

// EntryPatch mirrors the PUT /api/entries/{id} body. PUT replaces the
// caller's whole overlay: an omitted field is stored as "no overlay" and
// shows the shared value again, so omitting a field is how it is reverted
// (an empty patch removes the overlay entirely). Sending `readings: []`
// is different: it overlays an empty reading list.
export interface EntryPatchReading {
	type: string;
	value: string;
}

export interface EntryPatch {
	written?: string;
	readings?: EntryPatchReading[];
}

// EntryDraft is the editable state of an entry: the written form plus the
// reading rows in display order. Rows carry no ord; the server stores the
// list as sent.
export interface EntryDraft {
	written: string;
	readings: EntryPatchReading[];
}

// displayedReadings normalizes an entry's readings to the rows the editor
// shows: ordered by ord, with only the editable type and value.
function displayedReadings(entry: Entry): EntryPatchReading[] {
	return [...entry.readings]
		.sort((a, b) => a.ord - b.ord)
		.map(({ type, value }) => ({ type, value }));
}

function sameReadings(a: EntryPatchReading[], b: EntryPatchReading[]): boolean {
	return (
		a.length === b.length &&
		a.every((row, index) => row.type === b[index].type && row.value === b[index].value)
	);
}

/**
 * buildPatch compares the editor draft with the entry it started from and
 * returns only the changed fields. An unchanged draft yields an empty
 * patch, so a save never overwrites fields the user did not edit. Readings
 * are compared in their displayed (ord) order: edits, reordering, adding,
 * and removing rows all count as changes.
 */
export function buildPatch(original: Entry, draft: EntryDraft): EntryPatch {
	const patch: EntryPatch = {};

	if (draft.written !== original.written && draft.written.trim() !== '') {
		patch.written = draft.written;
	}

	if (!sameReadings(displayedReadings(original), draft.readings)) {
		patch.readings = draft.readings.map(({ type, value }) => ({ type, value }));
	}

	return patch;
}

/**
 * updateEntry stores the caller's overlay via PUT /api/entries/{id}. The
 * response is the caller's patched entry view, the same shape as
 * getEntry, so callers can render it without another request.
 */
export async function updateEntry(id: number, patch: EntryPatch): Promise<EntryDetail> {
	try {
		return await api<EntryDetail>(`/api/entries/${id}`, {
			method: 'PUT',
			body: patch
		});
	} finally {
		// The decks view caches bases with the overlay applied; an edit changes them.
		forgetEntryBases([id]);
	}
}
