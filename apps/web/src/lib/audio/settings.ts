/** The audio keys of the workspace settings. */
export const AUDIO_AUTOPLAY_KEY = 'audioAutoplay';
export const AUDIO_DEVICE_VOICE_KEY = 'audioDeviceVoice';

export interface AudioSettings {
	/** Play the recording when a study card is revealed. Default off. */
	autoplay: boolean;
	/** Speak with the device's voice when no recording exists. Default on. */
	deviceVoice: boolean;
}

/** readAudioSettings reads the audio keys of a workspace's settings; anything but a boolean falls back to the default. */
export function readAudioSettings(settings: Record<string, unknown> | null | undefined): AudioSettings {
	const s = settings ?? {};
	return {
		autoplay: typeof s[AUDIO_AUTOPLAY_KEY] === 'boolean' ? (s[AUDIO_AUTOPLAY_KEY] as boolean) : false,
		deviceVoice: typeof s[AUDIO_DEVICE_VOICE_KEY] === 'boolean' ? (s[AUDIO_DEVICE_VOICE_KEY] as boolean) : true
	};
}
