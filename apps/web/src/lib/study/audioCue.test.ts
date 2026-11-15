import { describe, expect, it } from 'vitest';
import type { AudioClip, AudioResolution } from '../api/audio';
import type { Entry } from '../api/types';
import { autoplayDue, cardAudio, isPlayKey } from './audioCue';

const clip = (n: string): AudioClip => ({ url: `/c/${n}.opus`, packId: 'p', license: 'CC0', attribution: 'A', source: '' });
const entry = { id: 5, language: 'ja', written: '風', readings: [] } as unknown as Entry;
const settings = { autoplay: false, deviceVoice: true };

describe('cardAudio', () => {
	it('is the headword clips with the device-voice text and settings', () => {
		const res: AudioResolution = { terms: [clip('a')], syllables: null };
		expect(cardAudio(entry, res, settings)).toEqual({ clips: [clip('a')], speakText: '風', lang: 'ja', deviceVoice: true });
	});
	it('has no clips when the entry is unresolved', () => {
		expect(cardAudio(entry, undefined, { autoplay: true, deviceVoice: false })).toEqual({ clips: [], speakText: '風', lang: 'ja', deviceVoice: false });
	});
});

describe('autoplayDue', () => {
	it('plays once on reveal, only when the setting is on', () => {
		expect(autoplayDue({ done: true, autoplay: true, playedFor: null, key: '3' })).toBe(true);
		expect(autoplayDue({ done: true, autoplay: true, playedFor: '3', key: '3' })).toBe(false);
		expect(autoplayDue({ done: true, autoplay: true, playedFor: '2', key: '3' })).toBe(true);
	});
	it('never plays before the reveal or with autoplay off', () => {
		expect(autoplayDue({ done: false, autoplay: true, playedFor: null, key: '3' })).toBe(false);
		expect(autoplayDue({ done: true, autoplay: false, playedFor: null, key: '3' })).toBe(false);
	});
});

describe('isPlayKey', () => {
	it('is p, either case, without modifiers', () => {
		expect(isPlayKey({ key: 'p' })).toBe(true);
		expect(isPlayKey({ key: 'P' })).toBe(true);
		expect(isPlayKey({ key: 'p', ctrlKey: true })).toBe(false);
		expect(isPlayKey({ key: 'q' })).toBe(false);
	});
});
