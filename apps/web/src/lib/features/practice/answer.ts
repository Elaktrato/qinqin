// One answer of a drill round as a study event (docs/contracts/drills/), and what a finished round shows.

import type { StudyEventBody } from '$lib/api/types';
import { drillPayload } from '$lib/events/eventPayloads';
import { newUlid } from '$lib/events/ulid';
import { drillEventType } from '$lib/studycore/drills';
import type { ReviewGrade } from '$lib/studycore/types';
import type { RoundEntry } from './types';

/**
 * answerEvent builds the event of one answer (written through the session's outbox); `extra` are the drill's own
 * members after the grade (#228).
 */
export function answerEvent(
	workspaceId: number,
	drill: string,
	item: string,
	mode: string,
	grade: ReviewGrade,
	now: number = Date.now(),
	extra?: Readonly<Record<string, string>>
): StudyEventBody {
	return {
		id: newUlid(now),
		workspaceId,
		device: 'web',
		ts: new Date(now).toISOString(),
		type: drillEventType(drill),
		payload: drillPayload(item, mode, grade, extra)
	};
}

export interface RoundResult {
	/** Answers graded Hard, Good or Easy. */
	right: number;
	total: number;
	/** The items answered Again, once each, in the order they came. */
	missed: RoundEntry[];
}

/** roundResult: Again is wrong; Hard (right after a hint), Good and Easy are right. */
export function roundResult(answers: readonly { entry: RoundEntry; grade: ReviewGrade }[]): RoundResult {
	const missed: RoundEntry[] = [];
	const seen = new Set<string>();
	let right = 0;
	for (const { entry, grade } of answers) {
		if (grade >= 2) {
			right++;
			continue;
		}
		const key = `${entry.drill}\u0000${entry.item.key}`;
		if (!seen.has(key)) {
			seen.add(key);
			missed.push(entry);
		}
	}
	return { right, total: answers.length, missed };
}
