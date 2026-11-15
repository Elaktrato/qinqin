// The training and evaluation input: each canonical card's valid reviews
// in replay order, reduced to (days since the previous review, grade).

import { isValidReview, sortedReviews } from '../scheduler';
import type { ReviewEvent } from '../types';
import { daysBetween, type Step } from './model';

export interface Dataset {
	/** `days` is each step's UTC day number (days since 1970-01-01), when known. */
	cards: { cardId: string; steps: Step[]; days?: number[] }[];
	/** Reviews after a card's first with at least one day since the previous. */
	labelled: number;
}

/**
 * buildDataset groups the valid reviews per card (sorted as the
 * scheduler sorts them) and orders the cards by id, so the same log
 * gives the same dataset on every device.
 */
export function buildDataset(reviews: readonly ReviewEvent[]): Dataset {
	const byCard = new Map<string, ReviewEvent[]>();
	for (const review of reviews) {
		if (!isValidReview(review)) continue;
		const list = byCard.get(review.payload.cardId);
		if (list === undefined) byCard.set(review.payload.cardId, [review]);
		else list.push(review);
	}
	const cards: Dataset['cards'] = [];
	let labelled = 0;
	for (const cardId of [...byCard.keys()].sort()) {
		const history = sortedReviews(byCard.get(cardId) ?? []);
		const steps: Step[] = history.map((review, i) => ({
			t: i === 0 ? 0 : daysBetween(history[i - 1].ts, review.ts),
			g: review.payload.grade
		}));
		for (let i = 1; i < steps.length; i++) if (steps[i].t >= 1) labelled++;
		const days = history.map((review) => Math.floor(Date.parse(review.ts) / 86_400_000));
		cards.push({ cardId, steps, days });
	}
	return { cards, labelled };
}
