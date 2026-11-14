/** Matcher thresholds in one place; tuned by feel (see the writing-feel spec). */
export const MATCH = {
	resample: 32,
	maxOffset: 0.3,
	minScale: 0.5,
	maxScale: 2.0,
	minCos: 0.5,
	maxShape: 0.2,
	maxEnd: 0.08,
	maxGap: 0.2,
	maxJoin: 3,
	minInk: 0.02
} as const;
