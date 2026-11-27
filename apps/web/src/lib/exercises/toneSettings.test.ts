import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/settings/tones.json';
import {
	TONE_SETTINGS_DEFAULTS,
	TONE_SETTINGS_KEY,
	TONE_SETTINGS_MEMBERS,
	hasToneSettings,
	readToneSettings,
	toneSettingPatch,
	type ToneSettingMember
} from './toneSettings';

describe('settings/tones fixture (#300)', () => {
	it('names the key, its members and their defaults', () => {
		expect(fixture.rule).toBe('settings/tones');
		expect(TONE_SETTINGS_KEY).toBe(fixture.key);
		expect([...TONE_SETTINGS_MEMBERS]).toEqual(fixture.members);
		expect(TONE_SETTINGS_DEFAULTS).toEqual(fixture.defaults);
	});

	it.each(fixture.parse)('parse: $name', ({ settings, expect: want }) => {
		expect(readToneSettings(settings as Record<string, unknown> | null)).toEqual(want);
	});

	it.each(fixture.languages)('languages: $language', ({ language, switches }) => {
		expect(hasToneSettings(language)).toBe(switches);
	});

	it.each(fixture.patch)('patch: $member', ({ member, value, expect: want }) => {
		expect(toneSettingPatch(member as ToneSettingMember, value)).toEqual(want);
	});
});
