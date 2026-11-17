// The compiled-in fallback themes (design §7, "Before anything loads"):
// Catppuccin Latte and Mocha, painted before GET /api/themes answers on a
// first visit, offline without stored tokens, or when a slot's theme is gone.
// Copied from server/internal/themes/builtin/catppuccin/themes.json;
// fallback.test.ts compares the two so they never drift. Catppuccin is MIT
// (static/CATPPUCCIN-LICENSE.TXT, credited on the Sources page).

import type { Theme } from './types';

export const FALLBACK_THEMES: readonly Theme[] = Object.freeze([
	{
		id: 'catppuccin-latte',
		name: 'Latte',
		family: 'Catppuccin',
		scheme: 'light',
		colors: {
			chrome: '#dce0e8',
			panel: '#eff1f5',
			raised: '#e6e9ef',
			line: '#ccd0da',
			text: '#4c4f69',
			muted: '#6c6f85',
			good: '#40a02b',
			warn: '#df8e1d',
			bad: '#d20f39',
			gradeAgain: '#d20f39',
			gradeHard: '#fe640b',
			gradeGood: '#40a02b',
			gradeEasy: '#1e66f5'
		},
		accents: {
			mauve: '#8839ef',
			pink: '#ea76cb',
			red: '#d20f39',
			peach: '#fe640b',
			yellow: '#df8e1d',
			green: '#40a02b',
			teal: '#179299',
			sky: '#04a5e5',
			blue: '#1e66f5',
			lavender: '#7287fd'
		},
		defaultAccent: 'mauve'
	},
	{
		id: 'catppuccin-mocha',
		name: 'Mocha',
		family: 'Catppuccin',
		scheme: 'dark',
		colors: {
			chrome: '#11111b',
			panel: '#1e1e2e',
			raised: '#313244',
			line: '#45475a',
			text: '#cdd6f4',
			muted: '#a6adc8',
			good: '#a6e3a1',
			warn: '#f9e2af',
			bad: '#f38ba8',
			gradeAgain: '#f38ba8',
			gradeHard: '#fab387',
			gradeGood: '#a6e3a1',
			gradeEasy: '#89b4fa'
		},
		accents: {
			mauve: '#cba6f7',
			pink: '#f5c2e7',
			red: '#f38ba8',
			peach: '#fab387',
			yellow: '#f9e2af',
			green: '#a6e3a1',
			teal: '#94e2d5',
			sky: '#89dceb',
			blue: '#89b4fa',
			lavender: '#b4befe'
		},
		defaultAccent: 'mauve'
	}
]);

/** fallbackTheme: the compiled-in default theme of a slot. */
export function fallbackTheme(slot: 'light' | 'dark'): Theme {
	return FALLBACK_THEMES[slot === 'light' ? 0 : 1];
}
