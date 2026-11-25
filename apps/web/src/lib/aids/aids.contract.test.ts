import { describe, expect, it } from 'vitest';

import anatomyFixture from '../../../../../docs/contracts/aids/anatomy.json';
import tonesFixture from '../../../../../docs/contracts/aids/tones.json';
import aidsFixture from '../../../../../docs/contracts/aids/visual-aids.json';
import { MAX_PARTS, anatomyOf } from './anatomy';
import { TONE_CONTOURS, TONE_SPECTRUM, toneColors, toneSegments } from './tones';
import { AID_DEFAULTS, AID_KEYS, VISUAL_AIDS_KEY, readVisualAids, visualAidPatch, type AidKey } from './visualAids';
import { ratio } from '$lib/theme/contrast';

describe('aids/visual-aids contract', () => {
	it('names the key, the aids and the defaults', () => {
		expect(VISUAL_AIDS_KEY).toBe(aidsFixture.key);
		expect([...AID_KEYS]).toEqual(aidsFixture.aids);
		expect(AID_DEFAULTS).toEqual(aidsFixture.defaults);
	});

	for (const c of aidsFixture.parse) {
		it(`parse: ${c.name}`, () => {
			expect(readVisualAids(c.settings as Record<string, unknown>)).toEqual(c.expect);
		});
	}

	for (const c of aidsFixture.patch) {
		it(`patch: ${c.name}`, () => {
			expect(visualAidPatch(c.aid as AidKey, c.on)).toEqual(c.patch);
		});
	}
});

describe('aids/tones contract', () => {
	it('pins the spectrum, the contrast bar and the contours', () => {
		expect([...TONE_SPECTRUM]).toEqual(tonesFixture.spectrum);
		expect(tonesFixture.minContrast).toBe(4.5);
		expect(Object.fromEntries(Object.entries(TONE_CONTOURS).map(([k, v]) => [k, v.path]))).toEqual(tonesFixture.contours);
	});

	for (const c of tonesFixture.segments) {
		it(`segments of "${c.value}"`, () => {
			expect(toneSegments(c.value).map((s) => [s.text, s.tone])).toEqual(c.segments);
		});
	}

	for (const c of tonesFixture.colors) {
		it(`colours on ${c.colors.panel}/${c.colors.text}`, () => {
			const got = toneColors(c.colors);
			expect(got).toEqual(c.expect);
			for (const color of got) expect(ratio(color, c.colors.panel)).toBeGreaterThanOrEqual(tonesFixture.minContrast);
		});
	}
});

describe('aids/anatomy contract', () => {
	const meanings = new Map(Object.entries(anatomyFixture.meanings));
	it('pins the cap', () => expect(MAX_PARTS).toBe(anatomyFixture.maxParts));

	for (const c of anatomyFixture.cases) {
		it(c.name, () => {
			const parts = anatomyOf(c.char, anatomyFixture.components, meanings, (c as { radical?: string }).radical);
			if ('expectGlyphs' in c) expect(parts.map((p) => p.glyph)).toEqual(c.expectGlyphs);
			else expect(parts.map((p) => [p.glyph, p.meaning, p.isRadical])).toEqual(c.expect);
		});
	}
});
