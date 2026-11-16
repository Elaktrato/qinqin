// recordLookup: the one place the reader, lessons and search hand a lookup
// to the tab's recorder (#72). No workspace (a book without one, a lesson
// in another language than the current workspace): nothing is recorded.

import type { LookupHit } from './lookups';
import type { LookupRecorder } from './recorder';
import { lookupRecorder } from './store';

export function recordLookup(
	ws: number | null | undefined,
	hit: Omit<LookupHit, 'at'>,
	recorder: Pick<LookupRecorder, 'note'> = lookupRecorder()
): void {
	if (ws === null || ws === undefined) return;
	const { bookId, ...rest } = hit;
	recorder.note(ws, typeof bookId === 'number' && Number.isSafeInteger(bookId) && bookId >= 1 ? { ...rest, bookId } : rest);
}
