// The payloads of the study events the web app writes, one builder per
// type, pinned by docs/contracts/events/payloads.json. `lookup` has no
// builder: it is never written since #72 (the history is the `lookups`
// row). `review` payloads are built by studycore/events.ts.

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

/** `script`: one answer of the writing-system trainer (#204): the system, the item or word, the mode, right or wrong. */
export function scriptPayload(system: string, item: string, mode: string, ok: boolean): { system: string; item: string; mode: string; ok: boolean } {
	return { system, item, mode, ok };
}

/** `grammar`: one finished grammar lesson run (#277): the grammar point (`<packId>:<lessonId>`), the mode, the score and the number of exercises. */
export function grammarPayload(packId: string, lessonId: string, score: number, total: number): { point: string; mode: 'lesson'; score: number; total: number } {
	return { point: `${packId}:${lessonId}`, mode: 'lesson', score, total };
}
