// The level rule of the graded readers (docs/contracts/graded/README.md, Level rule; Go:
// server/internal/library/sources/graded/rule.go): what a text's tokens count against a word level list, the share at
// or below a level, the words above it and the lowest level the text fits. A "read next" score (#183) counts a text the
// same way: function words and the text's names are left out, uncovered letters count as unknown words.

/** A text fits a level when at least this share of its counted tokens is at or below it (#183's target)... */
export const MIN_COVERAGE_PERCENT = 95;
/** ...and at most this many distinct words are above it. */
export const MAX_ABOVE = 6;

/** One segmenter match: its code-point range, surface and lemma, its lowest word level index (null: unlisted). */
export interface LevelToken {
	start: number;
	end: number;
	surface: string;
	lemma: string;
	level: number | null;
	function: boolean;
}

export interface LevelReport {
	counted: number;
	within: number;
	above: string[];
	computedLevel: number | null;
	unglossed: string[];
	ok: boolean;
}

interface Counted {
	at: number;
	lemma: string;
	surface: string;
	level: number | null;
}

const LETTER = /\p{L}/u;

/** checkText counts a text (its paragraphs joined by "\n") against `levels` levels at the declared level. */
export function checkText(
	text: string,
	names: readonly string[],
	tokens: readonly LevelToken[],
	levels: number,
	declared: number,
	glosses: readonly string[]
): LevelReport {
	const runes = Array.from(text);
	const inName = new Array<boolean>(runes.length).fill(false);
	for (const name of names) {
		const n = Array.from(name);
		if (n.length === 0) continue;
		for (let i = 0; i + n.length <= runes.length;) {
			if (n.every((c, k) => runes[i + k] === c)) {
				for (let j = i; j < i + n.length; j++) inName[j] = true;
				i += n.length;
			} else i++;
		}
	}
	const covered = new Array<boolean>(runes.length).fill(false);
	const items: Counted[] = [];
	for (const tk of tokens) {
		const start = Math.max(tk.start, 0);
		const end = Math.min(tk.end, runes.length);
		let overlaps = false;
		for (let i = start; i < end; i++) {
			covered[i] = true;
			if (inName[i]) overlaps = true;
		}
		if (tk.function || overlaps || start >= end) continue;
		items.push({
			at: start,
			lemma: tk.lemma || tk.surface,
			surface: tk.surface,
			level: tk.level
		});
	}
	for (let i = 0; i < runes.length;) {
		if (covered[i] || inName[i] || !LETTER.test(runes[i])) {
			i++;
			continue;
		}
		let j = i;
		while (
			j < runes.length &&
			!covered[j] &&
			!inName[j] &&
			LETTER.test(runes[j])
		)
			j++;
		const run = runes.slice(i, j).join('');
		items.push({ at: i, lemma: run, surface: run, level: null });
		i = j;
	}
	items.sort((a, b) => a.at - b.at);

	const within = (c: Counted, level: number) =>
		c.level !== null && c.level <= level;
	const above = (level: number): string[] => {
		const out: string[] = [];
		for (const c of items)
			if (!within(c, level) && !out.includes(c.lemma)) out.push(c.lemma);
		return out;
	};
	const fits = (level: number): boolean => {
		const n = items.filter((c) => within(c, level)).length;
		return (
			n * 100 >= MIN_COVERAGE_PERCENT * items.length &&
			above(level).length <= MAX_ABOVE
		);
	};

	let computedLevel: number | null = null;
	for (let l = 0; l < levels; l++) {
		if (fits(l)) {
			computedLevel = l;
			break;
		}
	}
	const aboveDeclared = above(declared);
	const unglossed = aboveDeclared.filter((lemma) => {
		const surface = items.find((c) => c.lemma === lemma)?.surface ?? lemma;
		return !glosses.some((g) => g.includes(lemma) || g.includes(surface));
	});
	return {
		counted: items.length,
		within: items.filter((c) => within(c, declared)).length,
		above: aboveDeclared,
		computedLevel,
		unglossed,
		ok: computedLevel === declared && unglossed.length === 0
	};
}
