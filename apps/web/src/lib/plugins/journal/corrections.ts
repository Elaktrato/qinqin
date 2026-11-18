// The margin's corrections (#103): one list in the text's order, each with
// its kind and state. Placed corrections come first (by position), then the
// ones the anchoring kept in the list only, then the ones no longer in the
// text. Rule: docs/contracts/journal/README.md.

import { t } from '$lib/i18n';
import type { Anchoring } from './anchor';
import { annotationKind, type AnnotationKind } from './review';
import type { Annotation, Review } from './types';

export type CorrectionState = 'placed' | 'listOnly' | 'missing';

export interface Correction {
	annotation: Annotation;
	kind: AnnotationKind;
	state: CorrectionState;
	/** The correction's position in this list (0-based). */
	index: number;
}

/** corrections: the margin list in text order. */
export function corrections(_review: Review, anchoring: Anchoring): Correction[] {
	const out: { annotation: Annotation; state: CorrectionState }[] = [
		...anchoring.placed
			.slice()
			.sort((a, b) => a.start - b.start)
			.map((p) => ({ annotation: p.annotation, state: 'placed' as const })),
		...anchoring.listOnly.map((annotation) => ({ annotation, state: 'listOnly' as const })),
		...anchoring.missing.map((annotation) => ({ annotation, state: 'missing' as const }))
	];
	return out.map(({ annotation, state }, index) => ({
		annotation,
		kind: annotationKind(annotation),
		state,
		index
	}));
}

/** correctionCounts: mistakes and suggestions that are still in the text. */
export function correctionCounts(list: readonly Correction[]): { mistakes: number; suggestions: number } {
	let mistakes = 0;
	let suggestions = 0;
	for (const c of list) {
		if (c.state === 'missing') continue;
		if (c.kind === 'suggestion') suggestions += 1;
		else mistakes += 1;
	}
	return { mistakes, suggestions };
}

/**
 * categoryLabel: the five schema categories are catalogue text; another
 * model category is shown as written, cut to 40 code points.
 */
export function categoryLabel(category: string): string {
	switch (category) {
		case 'grammar':
			return t('journal.category.grammar');
		case 'word choice':
			return t('journal.category.wordChoice');
		case 'spelling':
			return t('journal.category.spelling');
		case 'style':
			return t('journal.category.style');
		case 'other':
			return t('journal.category.other');
		default:
			return [...category].slice(0, 40).join('');
	}
}

/** nextId: the neighbour of `id` in the list; null at either end (no wrap). */
export function nextId(list: readonly Correction[], id: string, direction: -1 | 1): string | null {
	const at = list.findIndex((c) => c.annotation.id === id);
	if (at < 0) return null;
	const next = list[at + direction];
	return next === undefined ? null : next.annotation.id;
}
