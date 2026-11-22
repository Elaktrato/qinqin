// The one place a stored event becomes a review. The server only
// validates id and timestamp, so the payload is checked here; callers
// still filter by workspace themselves.

import type { StudyEvent } from '../events';
import { CARD_KINDS, type ReviewEvent, type ReviewGrade, type ReviewMeta, type StudyCardKind } from './types';

function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** parseMeta keeps well-formed meta only; anything off drops it whole. */
function parseMeta(raw: unknown): ReviewMeta | undefined {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
	const { tier, mistakes, hints, durationMs } = raw as Record<string, unknown>;
	const meta: ReviewMeta = {};
	if (tier !== undefined) {
		if (tier !== 0 && tier !== 1 && tier !== 2) return undefined;
		meta.tier = tier;
	}
	if (mistakes !== undefined) {
		if (!isCount(mistakes)) return undefined;
		meta.mistakes = mistakes;
	}
	if (hints !== undefined) {
		if (!isCount(hints)) return undefined;
		meta.hints = hints;
	}
	if (durationMs !== undefined) {
		if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
			return undefined;
		}
		meta.durationMs = durationMs;
	}
	return meta;
}

/**
 * parseReview narrows a stored event to a review. The real mode is kept;
 * a missing or unknown mode (events from before kinds existed) reads as
 * 'vocab'. A grade outside 1..4 or a missing card id rejects the event.
 */
export function parseReview(event: StudyEvent): ReviewEvent | null {
	if (event.type !== 'review') return null;
	const payload = event.payload;
	if (typeof payload !== 'object' || payload === null) return null;
	const { cardId, grade, mode, meta, replaces } = payload as Record<string, unknown>;
	if (typeof cardId !== 'string' || cardId === '') return null;
	if (typeof grade !== 'number' || !Number.isInteger(grade) || grade < 1 || grade > 4) {
		return null;
	}
	const realMode: StudyCardKind = CARD_KINDS.includes(mode as StudyCardKind)
		? (mode as StudyCardKind)
		: 'vocab';
	const parsed: ReviewEvent = {
		...event,
		type: 'review',
		payload: { cardId, mode: realMode, grade: grade as ReviewGrade }
	};
	const parsedMeta = parseMeta(meta);
	if (parsedMeta !== undefined) parsed.payload.meta = parsedMeta;
	// A changed grade names the review it replaces (#131, review-replace.json).
	if (typeof replaces === 'string' && replaces !== '') parsed.payload.replaces = replaces;
	return parsed;
}

/**
 * cardKey identifies a card by what it teaches: kind and entry, plus the
 * sentence for sentence cards (several sentences of one entry are
 * separate cards). Vocab, writing and tone cards ignore sentenceId,
 * which there only picks the example shown on the front.
 */
export function cardKey(kind: StudyCardKind, entryId: number, sentenceId?: number): string {
	if (kind === 'sentence') return `${kind}:${entryId}:${sentenceId ?? ''}`;
	return `${kind}:${entryId}`;
}
