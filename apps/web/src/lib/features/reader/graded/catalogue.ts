// The graded readers' catalogue as the Sources page shows it (#231, docs/contracts/graded/README.md): the level
// choices of a language and the texts of a choice, in catalogue order (level by level).
import type { GradedText } from '$lib/api/types';

/** GRADED_SOURCE is the library source of the graded readers: a graded book's `source`. */
export const GRADED_SOURCE = 'graded';

/** A level choice: its index in the scheme and its name ("HSK 2", "≈ N4"). */
export interface LevelChoice {
	level: number;
	name: string;
}

/** levelChoices are the levels the texts have, lowest first, each once. */
export function levelChoices(texts: readonly GradedText[]): LevelChoice[] {
	const out: LevelChoice[] = [];
	for (const t of texts)
		if (!out.some((c) => c.level === t.level))
			out.push({ level: t.level, name: t.levelName });
	return out.sort((a, b) => a.level - b.level);
}

/** textsAt are the texts of one level (all of them for null), in catalogue order. */
export function textsAt(
	texts: readonly GradedText[],
	level: number | null
): GradedText[] {
	return level === null ? [...texts] : texts.filter((t) => t.level === level);
}

/** KIND_KEYS name each kind's label in the message catalogue. */
export const KIND_KEYS = {
	story: 'reader.graded.kind.story',
	dialogue: 'reader.graded.kind.dialogue',
	info: 'reader.graded.kind.info'
} as const;
