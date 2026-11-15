// Test helper: a review history that makes a card strong (stability well
// above the "learned" edge), built by answering Easy at every due date.

import { DEFAULT_W } from '$lib/study/fsrs/params';
import { scheduleFor } from '$lib/study/scheduler';
import type { ReviewEvent } from '$lib/study/types';

export function strongReviews(cardId: string, start = '2025-01-01T00:00:00.000Z', n = 8): ReviewEvent[] {
	const events: ReviewEvent[] = [];
	let ts = start;
	for (let i = 0; i < n; i++) {
		events.push({
			id: `01JSTRONG${cardId}-${i}`,
			workspaceId: 1,
			device: 'test',
			ts,
			type: 'review',
			payload: { cardId, mode: 'vocab', grade: 4 }
		});
		const schedule = scheduleFor(cardId, events, new Date(ts), DEFAULT_W);
		ts = schedule?.due ?? ts;
	}
	return events;
}
