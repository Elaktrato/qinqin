// Pure helpers of the card manager: selection and the list it shows.

import type { StudyCard } from './types';

/** toggleId returns `ids` with `id` added, or removed if present. */
export function toggleId(ids: readonly string[], id: string): string[] {
	return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

/**
 * rangeIds is the inclusive run of `order` between two ids, in list
 * order (shift-click). An id that is not in the list collapses the range
 * to the other end.
 */
export function rangeIds(order: readonly string[], from: string, to: string): string[] {
	const a = order.indexOf(from);
	const b = order.indexOf(to);
	if (a === -1 && b === -1) return [];
	if (a === -1) return [to];
	if (b === -1) return [from];
	return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * wordsOfCards is what the card manager lists: one row per word, the
 * vocab cards, oldest first. Companion cards follow their word.
 */
export function wordsOfCards(cards: readonly StudyCard[]): StudyCard[] {
	return cards
		.filter((card) => card.kind === 'vocab')
		.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : 1));
}
