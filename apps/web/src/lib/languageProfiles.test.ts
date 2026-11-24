import { describe, expect, it } from 'vitest';
import fixture from '../../../../docs/contracts/languages/profiles.json';
import { PROFILES, hasCharacterMap, hasReadings, profileOf } from './languageProfiles';

// docs/contracts/languages/profiles.json: one core definition per language
// (#199); the Go table (server/internal/lang/profile.go) reads the same file.
describe('docs/contracts/languages/profiles.json', () => {
	it('holds exactly the fixture profiles, the fallback last', () => {
		expect(PROFILES).toEqual(fixture.profiles);
	});

	it.each(fixture.resolve)('resolves $code to $profile', ({ code, profile }) => {
		expect(profileOf(code).code).toBe(profile);
	});

	it('zh has tones, strokes and variants; ja kana; es none of them', () => {
		expect(profileOf('zh-TW')).toMatchObject({ script: 'han', tones: true, strokes: true, variants: true });
		expect(profileOf('ja')).toMatchObject({ script: 'han', tones: false, kana: true, segmentation: 'dictionary' });
		expect(profileOf('es')).toMatchObject({ script: 'latin', tones: false, segmentation: 'spaces', readings: [] });
		expect(profileOf('es').cardKinds).not.toContain('tone');
		expect(profileOf('es').practiceModes).not.toContain('characterMap');
	});

	it('hasCharacterMap follows practiceModes, hasReadings follows readings (#199 fix wave)', () => {
		expect([hasCharacterMap('zh-TW'), hasCharacterMap('ja'), hasCharacterMap('es'), hasCharacterMap('ko')]).toEqual([true, true, false, false]);
		expect([hasReadings('zh-TW'), hasReadings('ja-JP'), hasReadings('es'), hasReadings('')]).toEqual([true, true, false, false]);
	});
});
