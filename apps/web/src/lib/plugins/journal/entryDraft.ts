// Editor helpers: autosave timing, the review size limit and the
// once-per-day `journal` study event.

export const AUTOSAVE_MS = 1500;
export const MAX_REVIEW_CHARS = 5000;

/** Code points, the unit the server counts the review limit in. */
export function codePoints(text: string): number {
	let n = 0;
	for (const _ of text) n++;
	return n;
}

/**
 * True once per entry per UTC day, and only when the text changed. `sent`
 * remembers the day of the last event per entry and is updated here.
 */
export function journalEventDue(
	entryId: string,
	textChanged: boolean,
	now: Date,
	sent: Map<string, string>
): boolean {
	if (!textChanged) return false;
	const day = now.toISOString().slice(0, 10);
	if (sent.get(entryId) === day) return false;
	sent.set(entryId, day);
	return true;
}
