// The words around starting a study session without a connection.

import { t } from '$lib/i18n';
import type { StudySessionMode } from './session';
import type { StudyCardKind } from '$lib/studycore/types';

export function companionNote(): string {
	return t('study.offline.companion');
}

const COMPANION_KINDS: readonly StudyCardKind[] = ['sentence', 'writing', 'tone', 'reverse', 'cloze'];

/** sessionStartError: why a session did not start, in offline terms when that is the reason. */
export function sessionStartError(opts: { offline: boolean; mode: StudySessionMode; fallback: string }): string {
	if (!opts.offline) return opts.fallback;
	return opts.mode === 'levels'
		? t('study.offline.levelsNeedConnection')
		: t('study.offline.notReady');
}

/** showCompanionNote: offline sessions plan no companion cards; say so when some were asked for. */
export function showCompanionNote(opts: { offline: boolean; kinds: readonly StudyCardKind[] }): boolean {
	return opts.offline && opts.kinds.some((kind) => COMPANION_KINDS.includes(kind));
}
