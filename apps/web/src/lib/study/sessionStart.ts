// The words around starting a study session without a connection.

import type { StudySessionMode } from './session';
import type { StudyCardKind } from './types';

export const COMPANION_NOTE = 'Companion cards return when you are online.';

const COMPANION_KINDS: readonly StudyCardKind[] = ['sentence', 'writing', 'tone', 'reverse', 'cloze'];

/** sessionStartError: why a session did not start, in offline terms when that is the reason. */
export function sessionStartError(opts: { offline: boolean; mode: StudySessionMode; fallback: string }): string {
	if (!opts.offline) return opts.fallback;
	return opts.mode === 'levels'
		? 'Level sessions need a connection. Start a deck session instead.'
		: "This workspace isn't ready for offline study yet. Open it once while online.";
}

/** showCompanionNote: offline sessions plan no companion cards; say so when some were asked for. */
export function showCompanionNote(opts: { offline: boolean; kinds: readonly StudyCardKind[] }): boolean {
	return opts.offline && opts.kinds.some((kind) => COMPANION_KINDS.includes(kind));
}
