/** Matcher thresholds in one place; tuned by feel (see the writing-feel spec). */
export const MATCH = {
	resample: 32,
	/** Ink shorter than this (unit box) is a tap and ignored. */
	minInk: 0.02,

	// Absolute ceilings: ink beyond any of these never matches a stroke.
	/** Overall start→end direction: cosine of the angle between ink and stroke chords (0.5 = ±60°). */
	minCos: 0.5,
	/** Strokes whose chord is shorter than this share of their length (loops) skip the direction test. */
	minChord: 0.25,
	/** The same test on each half of the stroke, and on each stroke of a join (cosine 0.3 = about ±72°). */
	minHalfCos: 0.3,
	/** Mean point distance after aligning position and size, over the stroke length. */
	maxShape: 0.24,
	/** Short strokes are normalised by at least this length, so a hand's wobble on a dot is not magnified. */
	shapeFloor: 0.18,
	/** ...and long strokes and joins by at most this, so a long stroke is not judged loosely in absolute terms. */
	shapeCap: 0.4,
	/** Farthest point of either path from the other, over the stroke length (at least shapeFloor). */
	maxDev: 0.22,
	maxOffset: 0.3,
	/** Sizes (rms radius) below this count as this, so a dot drawn small is not "too small". */
	sizeFloor: 0.02,
	minScale: 0.45,
	maxScale: 2.2,

	// Hooks and brush entries: a short end segment after a sharp turn is optional.
	/** A stroke's entry tick: at most this share of the length, turning off the body by at least headTurn degrees. */
	headMax: 0.12,
	headTurn: 35,
	/** A stroke's hook: at most this share of the length, turning off the body by at least tailTurn degrees. */
	tailMax: 0.25,
	/** An entry tick or hook is at most this share of its own stroke (in a join: the first or last stroke). */
	maxCutShare: 0.5,
	/** The ink's own hook may be longer (exaggerated) than the stroke's. */
	inkTailMax: 0.5,
	tailTurn: 50,
	/** The body direction before a cut is the chord over this share of the length. */
	cutBody: 0.15,
	/** ...and must itself be straight to within this many degrees. */
	cutStraight: 30,
	/** A hook or tick is at least this long (absolute, and as a share of the length). */
	minHook: 0.02,
	minHookShare: 0.04,
	/** An exaggerated hook must point within about ±70° of the stroke's hook. */
	minHookCos: 0.35,
	/** Cost added when a hook is compared without its hook (missing or trimmed). */
	trimPenalty: 0.02,

	// The learner's ink: a flick back at either end (pen-lift recoil, lead-in) of at most recoilMax
	// and recoilShare of the ink's length, turning back by recoilTurn degrees or more, is dropped.
	recoilMax: 0.035,
	recoilShare: 0.1,
	recoilTurn: 120,

	// Ranking: the expected stroke must fit about as well as every other stroke of the character.
	/** Cost = shape + offsetWeight x centroid offset + scaleWeight x |ln size ratio| (+ trimPenalty, + joinCost per extra stroke). */
	offsetWeight: 0.5,
	scaleWeight: 0.1,
	/** The expected stroke wins unless another stroke fits better by more than this cost; ink that fits only another stroke misses with reason 'order'. */
	rankMargin: 0.03,
	/** Cost added per stroke beyond the first in a join, so one stroke is not credited as two. */
	joinCost: 0.03,

	// Joins: one motion may cover up to maxJoin strokes in a row, where the pen flows from one stroke into the next.
	/** A stroke that ends within this distance of the next one's start flows on (the gap rule). */
	maxGap: 0.2,
	/**
	 * A stroke that ends pointing at the next one's start also flows on (#292: the flow rule; き 3+4, さ 2+3, こ,
	 * た 3+4): the next start is at most flowGap away and within ±60° (cosine flowCos) of the direction the stroke ends
	 * in. Such a join covers two strokes only.
	 */
	flowGap: 0.5,
	flowCos: 0.5,
	/** ...and the next stroke keeps at least this share of the gap away from where the stroke ended (no retrace). */
	flowClear: 0.4,
	/** The direction a stroke ends in: the chord over this share of its length (at least flowTailMin). */
	flowTail: 0.15,
	flowTailMin: 0.03,
	maxJoin: 3
} as const;
