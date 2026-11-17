// Theme shapes of docs/contracts/themes/ (a theme as GET /api/themes serves
// it, and the derived tokens).

export const COLOR_KEYS = [
	'chrome',
	'panel',
	'raised',
	'line',
	'text',
	'muted',
	'good',
	'warn',
	'bad',
	'gradeAgain',
	'gradeHard',
	'gradeGood',
	'gradeEasy'
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];
export type ThemeColors = Record<ColorKey, string>;

export interface Theme {
	id: string;
	name: string;
	family?: string;
	scheme: 'light' | 'dark';
	colors: ThemeColors;
	/** Accent key -> colour, in the file's order (keys are never integer-like). */
	accents: Record<string, string>;
	defaultAccent: string;
}

export interface Mark {
	color: string;
	style: 'solid' | 'dotted' | 'wavy';
}

export interface Derived {
	accentKey: string;
	accent: string;
	onAccent: string;
	hair: string;
	accentTints: Record<'14' | '32' | '58' | '100', string>;
	primaryWash: string;
	selectedWash: string;
	mastery: string[];
	readingAccent: string;
	highlightWash: string;
	wordMarks: { new: Mark; learning: Mark };
	correctionMarks: { mistake: Mark; suggestion: Mark };
	accentChoices: string[];
}
