// Tone colours (#212): each pinyin syllable is drawn in the colour of its tone and with its contour under it.
// The contour is the cue that does not depend on colour (colour-blind readers, forced colours, print). The
// colours start from the Okabe-Ito set (distinguishable under the common colour vision deficiencies) and are
// darkened or lightened toward the theme's text colour until they read on the panel. Contract: docs/contracts/aids/.

import { t } from '$lib/i18n';
import { parsePinyin } from '$lib/study/tones';
import { MIN_TEXT, ratio } from '$lib/theme/contrast';
import type { ThemeColors } from '$lib/theme/types';

export type ToneNumber = 1 | 2 | 3 | 4 | 5;

export interface ToneSegment {
	text: string;
	/** The syllable's tone, null for a separator or a token that is not a marked pinyin syllable. */
	tone: ToneNumber | null;
}

const SEPARATORS = /([\s'’ʼ`]+)/;
// A syllable: Latin letters (with tone marks and ü) only; a digit or anything else makes it "not pinyin".
const SYLLABLE = /^[\p{Script=Latin}\p{M}]+$/u;

const isVowel = (ch: string): boolean => /^[aeiouü]$/i.test(ch.normalize('NFD')[0] ?? '');

/**
 * splitRun cuts a run-together token ("Běijīng", "tāmen") into syllables: between two vowel groups the consonants
 * belong to the next syllable's initial (one letter, or zh/ch/sh), the rest to the coda (n, ng, r) of the last.
 */
function splitRun(token: string): string[] {
	const chars = [...token.normalize('NFC')];
	const pieces: string[] = [];
	let start = 0;
	let i = 0;
	while (i < chars.length) {
		while (i < chars.length && !isVowel(chars[i])) i++;
		while (i < chars.length && isVowel(chars[i])) i++;
		const runStart = i;
		while (i < chars.length && !isVowel(chars[i])) i++;
		if (i >= chars.length) break;
		const run = chars.slice(runStart, i).join('').toLowerCase();
		const initial = run.length >= 2 && /(zh|ch|sh)$/.test(run) ? 2 : 1;
		const cut = i - initial;
		pieces.push(chars.slice(start, cut).join(''));
		start = cut;
	}
	pieces.push(chars.slice(start).join(''));
	return pieces.filter((p) => p !== '');
}

/** toneSegments splits a pinyin reading into syllables (with tones) and the separators between them. */
export function toneSegments(value: string): ToneSegment[] {
	const out: ToneSegment[] = [];
	for (const part of value.split(SEPARATORS)) {
		if (part === '') continue;
		if (SEPARATORS.test(part) || !SYLLABLE.test(part)) {
			out.push({ text: part, tone: null });
			continue;
		}
		for (const piece of splitRun(part)) {
			const syllable = parsePinyin(piece)[0];
			out.push({ text: piece, tone: syllable ? (syllable.tone as ToneNumber) : null });
		}
	}
	return out;
}

export interface ToneContour {
	/** An SVG path in a 10 x 10 box (a polyline; the neutral tone is a dot). */
	path: string;
}

/** The contour of each tone, drawn left to right, high at the top (the Chao tone letters' shapes). */
export const TONE_CONTOURS: Readonly<Record<ToneNumber, ToneContour>> = {
	1: { path: 'M1 2 H9' },
	2: { path: 'M1 8 L9 2' },
	3: { path: 'M1 3 L4 8 L9 2' },
	4: { path: 'M1 2 L9 8' },
	5: { path: 'M4 5 H6' }
};

/** toneName: the tone's name in the interface language ("First tone: high and level"), for a tooltip. */
export function toneName(tone: ToneNumber): string {
	switch (tone) {
		case 1:
			return t('study.aids.tone.first');
		case 2:
			return t('study.aids.tone.second');
		case 3:
			return t('study.aids.tone.third');
		case 4:
			return t('study.aids.tone.fourth');
		default:
			return t('study.aids.tone.neutral');
	}
}

/** The colour-blind-safe starting hues of tones 1-4: Okabe-Ito blue, orange, bluish green, reddish purple. */
export const TONE_SPECTRUM: readonly string[] = ['#0072b2', '#e69f00', '#009e73', '#cc79a7'];

const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);

function mix(from: string, to: string, p: number): string {
	return (
		'#' +
		[0, 1, 2]
			.map((i) =>
				Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * p)
					.toString(16)
					.padStart(2, '0')
			)
			.join('')
	);
}

/** readable: `color` moved toward the theme text in 5% steps until it reads on the panel (the text itself at the end). */
function readable(color: string, colors: Pick<ThemeColors, 'panel' | 'text'>): string {
	for (let step = 0; step <= 20; step++) {
		const c = step === 20 ? colors.text : mix(color, colors.text, step / 20);
		if (ratio(c, colors.panel) >= MIN_TEXT) return c;
	}
	return colors.text;
}

/**
 * toneColors: the colour of tones 1 to 5 for a theme's colours. Tones 1-4 are the Okabe-Ito hues made readable
 * on the panel; the neutral tone is the theme's muted text colour (or the text colour when muted does not read).
 */
export function toneColors(colors: Pick<ThemeColors, 'panel' | 'text' | 'muted'>): string[] {
	const out = TONE_SPECTRUM.map((c) => readable(c, colors));
	out.push(ratio(colors.muted, colors.panel) >= MIN_TEXT ? colors.muted : colors.text);
	return out;
}
