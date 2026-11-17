// Derived tokens (docs/contracts/themes/README.md, "Derived tokens"): one
// rule for the server, the web and Android; never stored in a theme file.

import { MIN_GRAPH, MIN_TEXT, onAccent, ratio } from './contrast';
import type { Derived, Theme } from './types';

/** withAlpha: `#rrggbb` plus the two hex digits of floor((p*255 + 50) / 100). */
export function withAlpha(color: string, p: number): string {
	return (
		color +
		Math.floor((p * 255 + 50) / 100)
			.toString(16)
			.padStart(2, '0')
	);
}

/** accentChoices: accents at least 3:1 on panel, in file order; never empty. */
export function accentChoices(theme: Theme): string[] {
	const out = Object.entries(theme.accents)
		.filter(([, color]) => ratio(color, theme.colors.panel) >= MIN_GRAPH)
		.map(([key]) => key);
	return out.length > 0 ? out : [theme.defaultAccent];
}

/** derive: the derived tokens of `theme` with the requested accent (null or not offered = the default). */
export function derive(theme: Theme, accent: string | null): Derived {
	const choices = accentChoices(theme);
	const accentKey = accent !== null && choices.includes(accent) ? accent : theme.defaultAccent;
	const c = theme.colors;
	const acc = theme.accents[accentKey];
	const tints = {
		'14': withAlpha(acc, 14),
		'32': withAlpha(acc, 32),
		'58': withAlpha(acc, 58),
		'100': withAlpha(acc, 100)
	};
	const hair = withAlpha(c.line, 55);
	return {
		accentKey,
		accent: acc,
		onAccent: onAccent(c.chrome, acc),
		hair,
		accentTints: tints,
		primaryWash: tints['14'],
		selectedWash: tints['14'],
		mastery: [hair, tints['14'], tints['32'], tints['58'], tints['100']],
		readingAccent: ratio(acc, c.panel) >= MIN_TEXT ? acc : c.text,
		highlightWash: withAlpha(c.warn, 24),
		wordMarks: {
			new: { color: acc, style: 'solid' },
			learning: { color: c.warn, style: 'dotted' }
		},
		correctionMarks: {
			mistake: { color: c.gradeAgain, style: 'wavy' },
			suggestion: { color: c.gradeEasy, style: 'dotted' }
		},
		accentChoices: choices
	};
}

/** The CSS custom properties a theme sets on :root (README table). */
export const TOKEN_NAMES = [
	'--chrome',
	'--panel',
	'--raised',
	'--line',
	'--text',
	'--muted',
	'--good',
	'--warn',
	'--bad',
	'--grade-again',
	'--grade-hard',
	'--grade-good',
	'--grade-easy',
	'--accent',
	'--on-accent',
	'--hair',
	'--reading-accent',
	'--accent-14',
	'--accent-32',
	'--accent-58',
	'--accent-100',
	'--primary-wash',
	'--selected-wash',
	'--highlight-wash',
	'--mastery-0',
	'--mastery-1',
	'--mastery-2',
	'--mastery-3',
	'--mastery-4'
] as const;
export type TokenName = (typeof TOKEN_NAMES)[number];

/** cssVariables: every property of TOKEN_NAMES for one theme and its derived tokens. */
export function cssVariables(theme: Theme, d: Derived): Record<TokenName, string> {
	const c = theme.colors;
	return {
		'--chrome': c.chrome,
		'--panel': c.panel,
		'--raised': c.raised,
		'--line': c.line,
		'--text': c.text,
		'--muted': c.muted,
		'--good': c.good,
		'--warn': c.warn,
		'--bad': c.bad,
		'--grade-again': c.gradeAgain,
		'--grade-hard': c.gradeHard,
		'--grade-good': c.gradeGood,
		'--grade-easy': c.gradeEasy,
		'--accent': d.accent,
		'--on-accent': d.onAccent,
		'--hair': d.hair,
		'--reading-accent': d.readingAccent,
		'--accent-14': d.accentTints['14'],
		'--accent-32': d.accentTints['32'],
		'--accent-58': d.accentTints['58'],
		'--accent-100': d.accentTints['100'],
		'--primary-wash': d.primaryWash,
		'--selected-wash': d.selectedWash,
		'--highlight-wash': d.highlightWash,
		'--mastery-0': d.mastery[0],
		'--mastery-1': d.mastery[1],
		'--mastery-2': d.mastery[2],
		'--mastery-3': d.mastery[3],
		'--mastery-4': d.mastery[4]
	};
}
