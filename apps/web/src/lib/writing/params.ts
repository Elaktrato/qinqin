/** Matcher thresholds in one place; tuned by feel (see the writing-feel spec). */
export const MATCH = {
	resample: 32,
	maxOffset: 0.3,
	minScale: 0.5,
	maxScale: 2.0,
	minCos: 0.5,
	maxShape: 0.2,
	maxEnd: 0.08,
	/** Absolute floor for the endpoint tolerance, so short strokes are not judged to the millimetre. */
	minEndTol: 0.04,
	/** Ink that also fits a later stroke and sits nearer to it (distance ratio and absolute gain) than to the expected one was drawn out of order. */
	laterRatio: 0.3,
	laterGain: 0.05,
	/** How many strokes ahead of the expected one are checked for an out-of-order fit. */
	lookahead: 3,
	maxGap: 0.2,
	maxJoin: 3,
	minInk: 0.02
} as const;
