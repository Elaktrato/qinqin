// Fit metrics of a weight set on a dataset: mean binary cross-entropy of
// the predicted recall and the calibration error over 20 recall bins.

import type { Dataset } from './dataset';
import { numberNum, replay } from './model';

const BINS = 20;
const EPS = 1e-6;

export interface Fit {
	logLoss: number;
	rmseBins: number;
	/** Labelled items that were counted. */
	items: number;
}

/**
 * evaluate scores `w` on the labelled items of `data`. With `sinceDay`
 * only items on or after that UTC day count, but every card is still
 * replayed from its first review.
 */
export function evaluate(
	w: readonly number[],
	data: Dataset,
	opts: { sinceDay?: number } = {}
): Fit {
	const sumR = new Float64Array(BINS);
	const sumY = new Float64Array(BINS);
	const count = new Float64Array(BINS);
	let loss = 0;
	let items = 0;
	const weights = [...w];
	for (const card of data.cards) {
		replay(numberNum, weights, card.steps, (r, y, index) => {
			if (opts.sinceDay !== undefined && (card.days?.[index] ?? -Infinity) < opts.sinceDay) return;
			const p = Math.min(Math.max(r, EPS), 1 - EPS);
			loss -= y === 1 ? Math.log(p) : Math.log(1 - p);
			const bin = Math.min(BINS - 1, Math.max(0, Math.floor(r * BINS)));
			sumR[bin] += r;
			sumY[bin] += y;
			count[bin] += 1;
			items++;
		});
	}
	if (items === 0) return { logLoss: 0, rmseBins: 0, items: 0 };
	let squared = 0;
	for (let b = 0; b < BINS; b++) {
		if (count[b] === 0) continue;
		const gap = sumR[b] / count[b] - sumY[b] / count[b];
		squared += count[b] * gap * gap;
	}
	return { logLoss: loss / items, rmseBins: Math.sqrt(squared / items), items };
}
