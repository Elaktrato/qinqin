import { describe, expect, it } from 'vitest';
import { readAudioSettings } from './settings';

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
