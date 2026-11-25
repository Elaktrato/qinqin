import { describe, expect, it } from 'vitest';
import { ratio } from '$lib/theme/contrast';
import { FALLBACK_THEMES } from '$lib/theme/fallback';
import { TONE_CONTOURS, TONE_SPECTRUM, toneColors, toneName, toneSegments } from './tones';

describe('toneSegments', () => {
	it('splits marked pinyin into syllables with their tone, keeping the separators', () => {
		expect(toneSegments('nǐ hǎo')).toEqual([
			{ text: 'nǐ', tone: 3 },
			{ text: ' ', tone: null },
			{ text: 'hǎo', tone: 3 }
		]);
	});

	it('reads all five tones, the neutral tone being an unmarked syllable', () => {
		const tones = toneSegments('mā má mǎ mà ma')
			.filter((s) => s.tone !== null)
			.map((s) => s.tone);
		expect(tones).toEqual([1, 2, 3, 4, 5]);
	});

	it('keeps an apostrophe between syllables and does not colour it', () => {
		expect(toneSegments("xī'àn")).toEqual([
			{ text: 'xī', tone: 1 },
			{ text: "'", tone: null },
			{ text: 'àn', tone: 4 }
		]);
	});

	it('leaves a token that is not a pinyin syllable plain, and reads a capital letter', () => {
		expect(toneSegments('ni3 hǎo')[0]).toEqual({ text: 'ni3', tone: null });
		expect(toneSegments('B2B')).toEqual([{ text: 'B2B', tone: null }]);
	});

	it('cuts a run-together word into its syllables', () => {
		const cut = (v: string) => toneSegments(v).map((s) => `${s.text}:${s.tone}`);
		expect(cut('Běijīng')).toEqual(['Běi:3', 'jīng:1']);
		expect(cut('tāmen')).toEqual(['tā:1', 'men:5']);
		expect(cut('chángchéng')).toEqual(['cháng:2', 'chéng:2']);
		expect(cut('hǎochī')).toEqual(['hǎo:3', 'chī:1']);
		expect(cut('xiǎoháir')).toEqual(['xiǎo:3', 'háir:2']);
		expect(cut('lǜsè')).toEqual(['lǜ:4', 'sè:4']);
	});

	it('is the identity on the text, and empty for an empty string', () => {
		for (const v of ['nǐ hǎo', "xī'ān", 'lǜ sè', ' a  b ', '']) {
			expect(toneSegments(v).map((s) => s.text).join('')).toBe(v);
		}
		expect(toneSegments('')).toEqual([]);
	});
});

describe('tone contours (the cue that is not a colour)', () => {
	it('has one distinct shape per tone, with a catalogue name', () => {
		expect(Object.keys(TONE_CONTOURS)).toEqual(['1', '2', '3', '4', '5']);
		expect(new Set(Object.values(TONE_CONTOURS).map((c) => c.path)).size).toBe(5);
		expect([1, 2, 3, 4, 5].map((n) => toneName(n as 1 | 2 | 3 | 4 | 5))).toEqual([
			'First tone: high and level',
			'Second tone: rising',
			'Third tone: falling, then rising',
			'Fourth tone: falling',
			'Neutral tone: short and light'
		]);
	});
});

describe('toneColors', () => {
	it('gives five colours readable (4.5:1) on the panel of every shipped theme', () => {
		for (const theme of FALLBACK_THEMES) {
			const colors = toneColors(theme.colors);
			expect(colors).toHaveLength(5);
			for (const c of colors) expect(ratio(c, theme.colors.panel), `${theme.id} ${c}`).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('keeps the five colours distinct in every theme', () => {
		for (const theme of FALLBACK_THEMES) expect(new Set(toneColors(theme.colors)).size).toBe(5);
	});

	it('starts from the colour-blind-safe Okabe-Ito hues and leaves a hue alone that already reads', () => {
		for (const theme of FALLBACK_THEMES) {
			const colors = toneColors(theme.colors);
			for (let i = 0; i < 4; i++) {
				if (ratio(TONE_SPECTRUM[i], theme.colors.panel) >= 4.5) expect(colors[i]).toBe(TONE_SPECTRUM[i]);
			}
		}
	});

	it('the neutral tone follows the theme muted text', () => {
		const t = FALLBACK_THEMES[0];
		expect([t.colors.muted, t.colors.text]).toContain(toneColors(t.colors)[4]);
	});
});
