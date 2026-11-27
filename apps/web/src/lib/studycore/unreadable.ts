// Rows the study load could not read (docs/contracts/sync/, 'Reading rows'):
// a malformed row, or one a newer client wrote (a new member, a new kind).
// The load skips them and goes on; the session's UnreadableRows
// (unreadableReport.svelte.ts) keeps the last load's count per workspace for
// the study page's notice. This module holds the pure parts.

import { t } from '$lib/i18n';
import { ShownError } from '$lib/api/userError';
import type { StudyCollection } from './rows';

/** Unreadable rows per collection (typed collections and rows). */
export type UnreadableCounts = Partial<Record<StudyCollection | 'rows', number>>;

export interface UnreadableReport {
	workspaceId: number;
	counts: UnreadableCounts;
	total: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * rawIdentity: the identity of a typed row the strict decode refused, when its
 * identity member is still readable (`id`, `deckId`; '' for the workspace
 * limits row and the active set), else null.
 */
export function rawIdentity(collection: StudyCollection, raw: unknown): string | null {
	if (!isRecord(raw)) return null;
	switch (collection) {
		case 'cards':
		case 'decks':
		case 'fsrsSets':
			return typeof raw.id === 'string' && raw.id !== '' ? raw.id : null;
		case 'deckSettings':
			return typeof raw.deckId === 'string' && raw.deckId !== '' ? raw.deckId : null;
		case 'limits':
			if (raw.deckId === null) return '';
			return typeof raw.deckId === 'string' && raw.deckId !== '' ? raw.deckId : null;
		case 'fsrsActive':
			return '';
	}
}

/** unreadableNotice: the study page's text for the shown workspace, or null. */
export function unreadableNotice(report: UnreadableReport | null, workspaceId: number | null): string | null {
	if (report === null || workspaceId === null || report.workspaceId !== workspaceId || report.total === 0) return null;
	return t('study.unreadable.notice', { count: report.total });
}

/**
 * UnreadableRowError: a write would replace a stored row this version cannot
 * read (docs/contracts/sync/, 'Reading rows'); nothing was sent.
 */
export class UnreadableRowError extends ShownError {
	key: string;

	constructor(key: string) {
		super(t('study.store.unreadableRow')); // interface text: errorText shows it
		this.name = 'UnreadableRowError';
		this.key = key;
	}
}
