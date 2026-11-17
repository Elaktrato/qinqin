// Contrast as qinqin measures it (docs/contracts/themes/README.md, Contrast):
// WCAG 2.2 relative luminance, ratios rounded to two decimals half up.

import type { ColorKey, Theme } from './types';

export const MIN_TEXT = 4.5;
export const MIN_GRAPH = 3;

function channel(v: number): number {
	const c = v / 255;
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** luminance: the relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
	const n = parseInt(hex.slice(1, 7), 16);
	return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** ratio: the contrast ratio of two colours, rounded to two decimals half up. */
export function ratio(a: string, b: string): number {
	let la = luminance(a);
	let lb = luminance(b);
	if (la < lb) [la, lb] = [lb, la];
	return Math.floor(((la + 0.05) / (lb + 0.05)) * 100 + 0.5) / 100;
}

export interface Check {
	fg: string;
	bg: string;
	min: number;
	ratio: number;
	pass: boolean;
}

const PAIRS: ReadonlyArray<[ColorKey, ColorKey, number]> = [
	['text', 'panel', MIN_TEXT],
	['text', 'chrome', MIN_TEXT],
	['muted', 'panel', MIN_TEXT],
	['muted', 'chrome', MIN_TEXT],
	['gradeAgain', 'panel', MIN_GRAPH],
	['gradeHard', 'panel', MIN_GRAPH],
	['gradeGood', 'panel', MIN_GRAPH],
	['gradeEasy', 'panel', MIN_GRAPH]
];

/** review: the checks the staged-upload review reports, in order. */
export function review(theme: Theme): Check[] {
	const out: Check[] = PAIRS.map(([fg, bg, min]) => {
		const r = ratio(theme.colors[fg], theme.colors[bg]);
		return { fg, bg, min, ratio: r, pass: r >= min };
	});
	for (const [key, color] of Object.entries(theme.accents)) {
		const r = ratio(color, theme.colors.panel);
		out.push({
			fg: `accent:${key}`,
			bg: 'panel',
			min: MIN_GRAPH,
			ratio: r,
			pass: r >= MIN_GRAPH
		});
	}
	return out;
}

export function failing(checks: readonly Check[]): number {
	return checks.filter((c) => !c.pass).length;
}
