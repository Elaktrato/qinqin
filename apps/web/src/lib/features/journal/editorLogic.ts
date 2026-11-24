// Pure helpers behind the journal editor and review views.

import { t } from '$lib/i18n';
import { formatNumber } from '$lib/i18n/format';
import { ApiError } from '$lib/api/client';
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
			hint: input.banner ?? t('journal.gate.noKey'),
			settingsLink: true
		};
	}
	if (input.forReview && input.chars === 0) {
		return { enabled: false, hint: t('journal.gate.empty'), settingsLink: false };
	}
	if (input.forReview && input.chars > MAX_REVIEW_CHARS) {
		return {
			enabled: false,
			hint: t('journal.gate.tooLong'),
			settingsLink: false
		};
	}
	return { enabled: true, hint: null, settingsLink: false };
}


/** Annotations that are in the text (placed or overlapping), in review order. */
export function listedAnnotations(all: Annotation[], anchoring: Anchoring): Annotation[] {
	const gone = new Set(anchoring.missing.map((a) => a.id));
	return all.filter((a) => !gone.has(a.id));
}

export function reviewAnnouncement(corrections: number, missing: number): string {
	if (corrections === 0 && missing === 0) return t('journal.review.readyNone');
	return missing > 0
		? t('journal.review.readyMissing', { count: corrections, missing })
		: t('journal.review.ready', { count: corrections });
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export function saveStatusText(state: SaveState): string {
	switch (state) {
		case 'dirty':
			return t('journal.save.dirty');
		case 'saving':
			return t('journal.save.saving');
		case 'saved':
			return t('journal.save.saved');
		case 'error':
			return t('journal.save.error');
		default:
			return '';
	}
}

/**
 * What the editor shows, as one comparable value: a saved entry, or a new one
 * with its pre-filled title. Starting an entry from an idea while a new, still
 * unsaved entry is open changes only the title, and must reload the editor.
 */
export function editorTarget(entryId: string | null, initialTitle: string): string {
	return entryId === null ? `new:${initialTitle}` : `entry:${entryId}`;
}

/**
 * Cap on the entry textarea (UTF-16 units): the server's limit of 50000 code
 * points (docs/contracts/journal/entries.json `limits`). A code point is one
 * or two units, so text under this cap is never refused for its length.
 */
export const ENTRY_MAX_CHARS = 50000;

/** The first save of a new entry moves the address; not after the editor is gone or the route changed. */
export function canGotoAfterFirstSave(input: { destroyed: boolean; routeEntryId: string | null }): boolean {
	return !input.destroyed && input.routeEntryId === null;
}

/** What an in-app navigation does: leave now, or save first. */
export function navigationPlan(state: SaveState): 'proceed' | 'save-first' {
	return state === 'idle' || state === 'saved' ? 'proceed' : 'save-first';
}

/** A 404 from the entry or review route means the entry was deleted elsewhere. */
export function isEntryGone(err: unknown): boolean {
	return err instanceof ApiError && err.status === 404;
}

export function tooLongHint(chars: number): string {
	return chars > MAX_REVIEW_CHARS
		? t('journal.tooLongHint', { max: formatNumber(MAX_REVIEW_CHARS) })
		: '';
}

/** The server's title limit in code points (docs/contracts/journal/entries.json `limits`). */
export const ENTRY_TITLE_MAX = 200;

/**
 * plainText drops the control characters the server refuses in a title, a text or the guidance (all but line
 * breaks and tabs), such as a pasted vertical tab or form feed.
 */
export function plainText(s: string): string {
	return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
}

/** entryTitle: a title as the server takes it, plain text cut to ENTRY_TITLE_MAX code points. */
export function entryTitle(s: string): string {
	return [...plainText(s)].slice(0, ENTRY_TITLE_MAX).join('');
}
