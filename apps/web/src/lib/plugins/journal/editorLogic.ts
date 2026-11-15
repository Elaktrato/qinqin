// Pure helpers behind the journal editor and review views.

import { MAX_REVIEW_CHARS } from './entryDraft';
import type { Anchoring } from './anchor';
import type { Annotation } from './types';

export interface AiGate {
	enabled: boolean;
	hint: string | null;
	settingsLink: boolean;
}

/**
 * Whether the Review or Ideas button may be pressed, and why not.
 * `available` is null while the capabilities are still loading.
 */
export function aiButtonGate(input: {
	available: boolean | null;
	banner: string | null;
	chars: number;
	forReview: boolean;
}): AiGate {
	if (input.available === null) return { enabled: false, hint: null, settingsLink: false };
	if (!input.available) {
		return {
			enabled: false,
			hint: input.banner ?? 'Add an API key in Settings → AI',
			settingsLink: true
		};
	}
	if (input.forReview && input.chars === 0) {
		return { enabled: false, hint: 'Write something first', settingsLink: false };
	}
	if (input.forReview && input.chars > MAX_REVIEW_CHARS) {
		return {
			enabled: false,
			hint: 'Shorten the entry to 5,000 characters to review it',
			settingsLink: false
		};
	}
	return { enabled: true, hint: null, settingsLink: false };
}

export type CategoryKey = 'grammar' | 'word-choice' | 'spelling' | 'style' | 'other';

export function annotationCategory(category: string): CategoryKey {
	switch (category) {
		case 'grammar':
		case 'spelling':
		case 'style':
			return category;
		case 'word choice':
			return 'word-choice';
		default:
			return 'other';
	}
}

/** Annotations that are in the text (placed or overlapping), in review order. */
export function listedAnnotations(all: Annotation[], anchoring: Anchoring): Annotation[] {
	const gone = new Set(anchoring.missing.map((a) => a.id));
	return all.filter((a) => !gone.has(a.id));
}

export function reviewAnnouncement(corrections: number, missing: number): string {
	if (corrections === 0 && missing === 0) return 'Review ready: no corrections.';
	const base = `Review ready: ${corrections} ${corrections === 1 ? 'correction' : 'corrections'}`;
	return missing > 0 ? `${base}, ${missing} no longer in the text.` : `${base}.`;
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export function saveStatusText(state: SaveState): string {
	switch (state) {
		case 'dirty':
			return 'Unsaved changes';
		case 'saving':
			return 'Saving…';
		case 'saved':
			return 'Saved';
		case 'error':
			return 'Not saved. Retrying when you keep typing, or press Save.';
		default:
			return '';
	}
}
