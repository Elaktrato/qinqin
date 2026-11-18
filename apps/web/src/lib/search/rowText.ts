// The search result row's text (#104): the first gloss the workspace does
// not hide and the kind · level line.

import { t } from '$lib/i18n';
import type { SearchHit } from '$lib/api/types';

/** firstGloss: the first gloss of a visible dictionary, or '' when all are hidden. */
export function firstGloss(hit: SearchHit, hidden: ReadonlySet<number>): string {
	for (const gloss of hit.glosses ?? []) {
		if (!hidden.has(gloss.dictionaryId)) return gloss.gloss;
	}
	return '';
}

/** kindLevel: "Word · HSK 5", or just the kind when the hit has no level. */
export function kindLevel(hit: SearchHit): string {
	const kind = hit.kind === 'character' ? t('search.kind.character') : t('search.kind.word');
	const level = (hit.levels ?? [])[0];
	if (!level) return kind;
	const label = [level.scheme, level.level].filter(Boolean).join(' ');
	return t('search.rowKindLevel', { kind, level: label });
}
