// The language profiles (#199, docs/contracts/languages/profiles.json): one
// core definition per language of what it has: its script, readings,
// segmentation, tones, strokes, kana, script variants, the card kinds a
// session may hold and the practice modes. Availability checks read a
// profile instead of comparing language codes; reading code itself (pinyin,
// kana, deinflection) stays language code. The Go table is
// server/internal/lang/profile.go; both are pinned to the fixture.

import type { StudyCardKind } from './study/types';

export type Script = 'han' | 'latin' | 'other';
export type PracticeMode = 'decks' | 'levels' | 'characterMap';

export interface LanguageProfile {
	/** The primary subtag, or `*` for the fallback. */
	code: string;
	script: Script;
	/** The reading systems an entry carries (`pinyin`, `kana`). */
	readings: readonly string[];
	/** `dictionary`: words are found by dictionary lookup (no spaces); `spaces`: by the spaces between them. */
	segmentation: 'dictionary' | 'spaces';
	tones: boolean;
	strokes: boolean;
	kana: boolean;
	/** Traditional/simplified script variants. */
	variants: boolean;
	cardKinds: readonly StudyCardKind[];
	practiceModes: readonly PracticeMode[];
}

const ALL_PRACTICE: readonly PracticeMode[] = ['decks', 'levels', 'characterMap'];
const PLAIN_KINDS: readonly StudyCardKind[] = ['vocab', 'sentence', 'reverse', 'cloze'];

/** The profiles in the fixture's order; the fallback is last. */
export const PROFILES: readonly LanguageProfile[] = [
	{
		code: 'zh',
		script: 'han',
		readings: ['pinyin'],
		segmentation: 'dictionary',
		tones: true,
		strokes: true,
		kana: false,
		variants: true,
		cardKinds: ['vocab', 'sentence', 'writing', 'tone', 'reverse', 'cloze'],
		practiceModes: ALL_PRACTICE
	},
	{
		code: 'ja',
		script: 'han',
		readings: ['kana'],
		segmentation: 'dictionary',
		tones: false,
		strokes: false,
		kana: true,
		variants: false,
		cardKinds: ['vocab', 'sentence', 'writing', 'reverse', 'cloze'],
		practiceModes: ALL_PRACTICE
	},
	{
		code: 'es',
		script: 'latin',
		readings: [],
		segmentation: 'spaces',
		tones: false,
		strokes: false,
		kana: false,
		variants: false,
		cardKinds: PLAIN_KINDS,
		practiceModes: ['decks', 'levels']
	},
	{
		code: '*',
		script: 'other',
		readings: [],
		segmentation: 'spaces',
		tones: false,
		strokes: false,
		kana: false,
		variants: false,
		cardKinds: PLAIN_KINDS,
		practiceModes: ['decks', 'levels']
	}
];

const FALLBACK = PROFILES[PROFILES.length - 1];

/** profileOf resolves a language code by its primary subtag (`zh-TW` → zh); any other code gets the fallback. */
export function profileOf(code: string): LanguageProfile {
	const primary = code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
	return PROFILES.find((p) => p.code === primary && p.code !== '*') ?? FALLBACK;
}
