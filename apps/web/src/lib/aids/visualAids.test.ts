import { describe, expect, it } from 'vitest';
import { AID_DEFAULTS, AID_KEYS, VISUAL_AIDS_KEY, readVisualAids, visualAidPatch } from './visualAids';

describe('visual aids setting (#212)', () => {
	it('has the pinned defaults: tone colours, anatomy and pictures on', () => {
		expect([...AID_KEYS]).toEqual(['pictures', 'toneColors', 'anatomy']);
		expect(AID_DEFAULTS).toEqual({ pictures: true, toneColors: true, anatomy: true });
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
			anatomy: true
		});
	});

	it('writes one switch as a merge patch', () => {
		expect(visualAidPatch('anatomy', false)).toEqual({ visualAids: { anatomy: false } });
	});
});
