// recordLookup: the one place the reader, lessons and search hand a lookup
// to the session's recorder (#72). No workspace (a book without one, a lesson
// in another language than the current workspace): nothing is recorded.

import type { LookupHit } from './lookups';
import type { LookupRecorder } from './recorder';

/** recordLookup hands one lookup to `recorder` (the session's, `session.lookups.recorder`). */
export function recordLookup(
	recorder: Pick<LookupRecorder, 'note'>,
	ws: number | null | undefined,
	hit: Omit<LookupHit, 'at'>
): void {
	if (ws === null || ws === undefined) return;
	const { bookId, ...rest } = hit;
	recorder.note(ws, typeof bookId === 'number' && Number.isSafeInteger(bookId) && bookId >= 1 ? { ...rest, bookId } : rest);
}
