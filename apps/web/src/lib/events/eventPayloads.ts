// The payloads of the study events the web app writes, one builder per
// type, pinned by docs/contracts/events/payloads.json. `lookup` has no
// builder: it is never written since #72 (the history is the `lookups`
// row). `review` payloads are built by study/events.ts.

/** `session`: no payload (JSON null). */
export function sessionPayload(): null {
	return null;
}

/** `view`: the dictionary entry the page showed. */
export function viewPayload(entryId: number): { entryId: number } {
	return { entryId };
}

/** `read`: one flush of the reading timer, credited to the book. */
export function readPayload(bookId: number, seconds: number): { bookId: number; seconds: number } {
	return { bookId, seconds };
}

/** `journal`: the journal entry (its ULID) whose text changed. */
export function journalPayload(entryId: string): { entryId: string } {
	return { entryId };
}
