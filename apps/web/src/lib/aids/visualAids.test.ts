import { describe, expect, it } from 'vitest';
import { AID_DEFAULTS, AID_KEYS, VISUAL_AIDS_KEY, readVisualAids, visualAidPatch } from './visualAids';

describe('visual aids setting (#212)', () => {
	it('has the pinned defaults: tone colours, anatomy and pictures on', () => {
		expect([...AID_KEYS]).toEqual(['pictures', 'toneColors', 'toneContour', 'anatomy']);
		expect(AID_DEFAULTS).toEqual({ pictures: true, toneColors: true, toneContour: true, anatomy: true });
		expect(VISUAL_AIDS_KEY).toBe('visualAids');
	});

	it('reads the defaults when the key is absent or malformed', () => {
		for (const settings of [undefined, null, {}, { visualAids: null }, { visualAids: [] }, { visualAids: 'off' }]) {
			expect(readVisualAids(settings as Record<string, unknown> | null | undefined)).toEqual(AID_DEFAULTS);
		}
	});

	it('reads each switch alone; a non-boolean is the default; unknown members are ignored', () => {
		expect(readVisualAids({ visualAids: { toneColors: false, pictures: 'no', anatomy: 0, extra: false } })).toEqual({
			pictures: true,
			toneColors: false,
			toneContour: false,
			anatomy: true
		});
	});

	it('keeps the contour on when it is stored on beside tone colours off', () => {
		expect(readVisualAids({ visualAids: { toneColors: false, toneContour: true } })).toMatchObject({ toneColors: false, toneContour: true });
	});

	it('writes one switch as a merge patch', () => {
		expect(visualAidPatch('anatomy', false)).toEqual({ visualAids: { anatomy: false } });
	});
});
