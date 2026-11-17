// The daily limit forms (workspace and deck): field states <-> rows. Pure.

import { t } from '$lib/i18n';
import { DEFAULT_LIMITS, MAX_LIMIT, type LimitPair } from '$lib/study/limits';

export type FieldMode = 'workspace' | 'value' | 'unlimited';

export interface FieldState {
	mode: FieldMode;
	value: string;
}

export type Field = keyof LimitPair;


/** deckFieldFrom: a deck row's field as a form state (absent follows the workspace). */
export function deckFieldFrom(row: Partial<LimitPair> | null, field: Field): FieldState {
	if (row === null || !(field in row)) return { mode: 'workspace', value: '' };
	const v = row[field];
	return v === null || v === undefined ? { mode: 'unlimited', value: '' } : { mode: 'value', value: String(v) };
}

/** workspaceFieldFrom: the workspace row's field, the default when absent. */
export function workspaceFieldFrom(row: Partial<LimitPair> | null, field: Field): FieldState {
	const v = row !== null && field in row ? row[field] : DEFAULT_LIMITS[field];
	return v === null || v === undefined ? { mode: 'unlimited', value: '' } : { mode: 'value', value: String(v) };
}

function parse(text: string): number | null {
	const t = String(text).trim();
	if (!/^\d{1,4}$/.test(t)) return null;
	const n = Number(t);
	return n <= MAX_LIMIT ? n : null;
}

function fieldValue(state: FieldState): number | null | undefined | 'invalid' {
	if (state.mode === 'workspace') return undefined;
	if (state.mode === 'unlimited') return null;
	const n = parse(state.value);
	return n === null ? 'invalid' : n;
}

function build(
	states: Record<Field, FieldState>
): { row: Partial<LimitPair> } | { error: string } {
	const row: Partial<LimitPair> = {};
	for (const field of ['new', 'reviews'] as const) {
		const v = fieldValue(states[field]);
		if (v === 'invalid') return { error: t('settings.limits.invalid') };
		if (v !== undefined) row[field] = v;
	}
	return { row };
}

/** deckRowFrom: the fields a deck row must carry (none = remove the row). */
export function deckRowFrom(
	newState: FieldState,
	reviewsState: FieldState
): { row: Partial<LimitPair> } | { error: string } {
	return build({ new: newState, reviews: reviewsState });
}

/** workspaceRowFrom: the workspace row (both fields; "use workspace" does not apply). */
export function workspaceRowFrom(
	newState: FieldState,
	reviewsState: FieldState
): { row: Partial<LimitPair> } | { error: string } {
	return build({ new: newState, reviews: reviewsState });
}

export function workspaceChoiceLabel(value: number | null): string {
	return t('settings.limits.useWorkspace', { value: value === null ? t('settings.limits.unlimited') : value });
}
