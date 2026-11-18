// The compiled-in fallback themes (design §7, "Before anything loads"):
// qinqin Day and qinqin Night, painted before GET /api/themes answers on a
// first visit, offline without stored tokens, or when a slot's theme is gone.
// Copied from server/internal/themes/builtin/qinqin/themes.json;
// fallback.test.ts compares the two so they never drift. The qinqin palettes
// are MIT (static/QINQIN-LICENSE.TXT, credited on the Sources page).

import type { Theme } from './types';

const themes: Theme[] = [
	{
		id: 'qinqin-day',
		name: 'qinqin Day',
		family: 'qinqin',
		scheme: 'light',
		colors: {
			chrome: '#e3f4fa',
			panel: '#ffffff',
			raised: '#eef9fd',
			line: '#c6e2ee',
			text: '#201533',
			muted: '#4b4d73',
			good: '#0b8457',
			warn: '#946500',
			bad: '#d2294f',
			gradeAgain: '#d2294f',
			gradeHard: '#bd5200',
			gradeGood: '#0b8457',
			gradeEasy: '#0077b3'
		},
		accents: {
			azure: '#0077b3',
			blue: '#1e579c',
			navy: '#203562',
			teal: '#00808a',
			violet: '#6b3fd6',
			pink: '#c4237a'
		},
		defaultAccent: 'azure'
	},
	{
		id: 'qinqin-night',
		name: 'qinqin Night',
		family: 'qinqin',
		scheme: 'dark',
		colors: {
			chrome: '#201533',
			panel: '#252446',
			raised: '#203562',
			line: '#1e579c',
			text: '#ffffff',
			muted: '#aebbdb',
			good: '#5fe39a',
			warn: '#ffc857',
			bad: '#ff6b8b',
			gradeAgain: '#ff6b8b',
			gradeHard: '#ffa45c',
			gradeGood: '#5fe39a',
			gradeEasy: '#0098db'
		},
		accents: {
			cyan: '#0ce6f2',
			azure: '#0098db',
			sky: '#7ab8ff',
			violet: '#b69cff',
			pink: '#ff7ab8',
			gold: '#ffd166'
		},
		defaultAccent: 'cyan'
	}
];

export const FALLBACK_THEMES: readonly Theme[] = Object.freeze(themes);

/** fallbackTheme: the compiled-in default theme of a slot. */
export function fallbackTheme(slot: 'light' | 'dark'): Theme {
	return FALLBACK_THEMES[slot === 'light' ? 0 : 1];
}
