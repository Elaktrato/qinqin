import { describe, expect, it } from 'vitest';
import { AUDIO_AUTOPLAY_KEY, AUDIO_DEVICE_VOICE_KEY, readAudioSettings } from './settings';
import settingsFixture from '../../../../../docs/contracts/settings/workspace-settings.json';

describe('readAudioSettings', () => {
	it('defaults to no autoplay and device voice on', () => {
		expect(readAudioSettings({})).toEqual({ autoplay: false, deviceVoice: true });
	});
	it('reads the workspace keys', () => {
		expect(readAudioSettings({ audioAutoplay: true, audioDeviceVoice: false })).toEqual({ autoplay: true, deviceVoice: false });
	});
	it('ignores values that are not booleans', () => {
		expect(readAudioSettings({ audioAutoplay: 'yes', audioDeviceVoice: 0 })).toEqual({ autoplay: false, deviceVoice: true });
	});
});

describe('docs/contracts/settings/workspace-settings.json: audio keys', () => {
	const fixture = settingsFixture as unknown as {
		rule: string;
		keys: { key: string; default: unknown }[];
		parse: { name: string; settings: Record<string, unknown> | null; expect: { audio: { autoplay: boolean; deviceVoice: boolean } } }[];
	};
	it('has the defaults of the key table', () => {
		expect(fixture.rule).toBe('settings/workspace-settings');
		const def = (k: string) => fixture.keys.find((x) => x.key === k)?.default;
		expect(readAudioSettings({})).toEqual({ autoplay: def(AUDIO_AUTOPLAY_KEY), deviceVoice: def(AUDIO_DEVICE_VOICE_KEY) });
	});
	for (const c of fixture.parse) {
		it(c.name, () => expect(readAudioSettings(c.settings)).toEqual(c.expect.audio));
	}
});
