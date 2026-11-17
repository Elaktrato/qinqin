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
	/** Error text: `bad` when it is at least 4.5:1 on panel, else `text`. */
	readableBad: string;
	/** Secondary text: `muted` when it is at least 4.5:1 on panel, else `text`. */
	readableMuted: string;
	/** Grade names as text: each grade colour when it is at least 4.5:1 on panel, else `text` (#101). */
	readableGrades: { again: string; hard: string; good: string; easy: string };
	/** The focus ring: `accent` when it is at least 3:1 on panel, raised and chrome, else `text`. */
	focusRing: string;
	highlightWash: string;
	/** The reader's highlight colours, named by their hue (yellow = warn). */
	highlights: { yellow: string; green: string; blue: string; pink: string };
	wordMarks: { new: Mark; learning: Mark };
	correctionMarks: { mistake: Mark; suggestion: Mark };
	accentChoices: string[];
}
