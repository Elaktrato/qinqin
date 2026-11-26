// The writing-system trainer (#204, kana #63): the shapes of the script data and of a practice question.
// The data files are in ./data (CC BY 4.0, written by the project; data/ATTRIBUTION.md).

export type SystemId = 'hiragana' | 'katakana' | 'hangul' | 'cyrillic';
export const SYSTEM_IDS: readonly SystemId[] = ['hiragana', 'katakana', 'hangul', 'cyrillic'];

/** recognise: glyph to sound. recall: sound to glyph. read: a syllable or word to its sound. type: sound to typed glyph. */
export type Mode = 'recognise' | 'recall' | 'read' | 'type';
export const MODES: readonly Mode[] = ['recognise', 'recall', 'read', 'type'];

/** One letter, jamo or kana of a chart. */
export interface ScriptItem {
	/** `<system>:<glyph>`: the key of the item's progress. */
	id: string;
	glyph: string;
	/** The lower-case form of a cased letter (Cyrillic). */
	lower?: string;
	/** The romanisation shown to the learner. */
	roman: string;
	/** Every spelling of the sound (the shown one, its parts at `/`, and the alternatives): two items that share one are confusable. */
	sounds: string[];
	/** The chart group (`basic`, `dakuten`, `consonant`, …). */
	group: string;
	/** What the voice speaks (a jamo alone is spoken as a syllable). */
	sound: string;
	/** The keyboard key (Hangul 2-set, ЙЦУКЕН) that types it. */
	key?: string;
	note?: string;
	lookalike?: boolean;
}

export interface ScriptWord {
	text: string;
	roman: string;
	/** English gloss (content, not interface text). */
	gloss: string;
}

export interface ScriptSystem {
	id: SystemId;
	language: string;
	groups: string[];
	items: ScriptItem[];
	words: ScriptWord[];
}

/** A question of a practice round. */
export interface Question {
	mode: Mode;
	system: SystemId;
	/** The key of the item or word the answer counts for (`hiragana:あ`, `hiragana:word:ねこ`). */
	itemId: string;
	/** What is shown (a glyph, a word, or a romanisation). */
	prompt: string;
	/** What the voice speaks for the prompt, if anything. */
	speak: string | null;
	/** The choices (empty for `type`). */
	options: string[];
	/** The correct choice, or for `type` the first accepted text. */
	answer: string;
	/** Every text that counts as correct. */
	accepts: string[];
	/** An English gloss shown after the answer (words). */
	gloss?: string;
	/** The key hint for a typing question. */
	key?: string;
}
