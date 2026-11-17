// Small checks the scheduling page makes before it trusts what it holds.

import { t } from '$lib/i18n';
import { weightsKey, type FsrsState } from './params';

/** sameWeights compares two weight lists by value. */
export function sameWeights(a: readonly number[], b: readonly number[]): boolean {
	return weightsKey(a) === weightsKey(b);
}

/**
 * shouldRestorePointer: an Undo writes the previous pointer back only
 * while the stored pointer is still the one this page wrote, so a change
 * made on another device in between is not overwritten.
 */
export function shouldRestorePointer(storedPointer: string | null, wrote: string | null): boolean {
	return storedPointer === wrote;
}

/** activeProblem explains an active pointer whose set cannot be read. */
export function activeProblem(state: FsrsState): string | null {
	if (state.pointer !== null && state.pointer !== undefined && state.active === null) {
		return t('study.fsrs.activeUnreadable');
	}
	return null;
}
