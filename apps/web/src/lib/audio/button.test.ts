import { describe, expect, it, vi } from 'vitest';
import type { AudioClip, AudioResolution } from '../api/audio';
import type { Reading } from '../api/types';
import { activate, buttonState, creditLine, headwordClips, readingClips } from './button';
import type { Player } from './player';

const clip = (n: string, attribution = 'Kanji alive', license = 'CC BY 4.0'): AudioClip => ({
	url: `/api/audio/clips/${n}.opus`,
	packId: 'p',
	license,
	attribution,
	source: ''
});

const input = (over: Partial<Parameters<typeof buttonState>[0]> = {}) => ({
	clips: [] as AudioClip[],
	speakText: '風',
	deviceVoice: true,
	voiceAvailable: true,
	...over
});

describe('buttonState', () => {
	it('is hidden without clips and without a usable voice', () => {
		expect(buttonState(input({ voiceAvailable: false })).visible).toBe(false);
		expect(buttonState(input({ deviceVoice: false })).visible).toBe(false);
		expect(buttonState(input({ speakText: undefined })).visible).toBe(false);
	});
	it('shows a device-voice button titled "Device voice"', () => {
		expect(buttonState(input())).toMatchObject({ visible: true, mode: 'voice', title: 'Device voice' });
	});
	it('shows a clip button even when the device voice is off or missing, titled with the credit', () => {
		const s = buttonState(input({ clips: [clip('a')], deviceVoice: false, voiceAvailable: false }));
		expect(s).toMatchObject({ visible: true, mode: 'clips', title: 'Audio: Kanji alive · CC BY 4.0' });
	});
});

describe('creditLine', () => {
	it('lists each distinct credit once, in order', () => {
		expect(creditLine([clip('a'), clip('b'), clip('c', 'Ann', 'CC0')])).toBe('Audio: Kanji alive · CC BY 4.0; Ann · CC0');
		expect(creditLine([])).toBe('');
	});
	it('does not repeat a licence the attribution already names', () => {
		expect(creditLine([clip('a', 'Kanji alive (https://kanjialive.com), CC BY 4.0', 'CC BY 4.0')])).toBe('Audio: Kanji alive (https://kanjialive.com), CC BY 4.0');
	});
});

function fakePlayer(over: Partial<Player> = {}): Player & { play: ReturnType<typeof vi.fn>; speak: ReturnType<typeof vi.fn> } {
	return { playing: false, stop: vi.fn(), play: vi.fn().mockResolvedValue(undefined), speak: vi.fn().mockReturnValue(true), ...over } as never;
}

describe('activate', () => {
	it('plays the clips', async () => {
		const player = fakePlayer();
		await activate(player, input({ clips: [clip('a')] }), 'ja');
		expect(player.play).toHaveBeenCalledWith([clip('a')]);
		expect(player.speak).not.toHaveBeenCalled();
	});
	it('falls back to the device voice when a clip fails', async () => {
		const player = fakePlayer({ play: vi.fn().mockRejectedValue(new Error('x')) });
		player.speak.mockImplementation((_t: string, _l: string, done?: () => void) => {
			done?.();
			return true;
		});
		await activate(player, input({ clips: [clip('a')] }), 'ja');
		expect(player.speak).toHaveBeenCalledWith('風', 'ja', expect.any(Function));
	});
	it('does not speak when the device voice is off', async () => {
		const player = fakePlayer({ play: vi.fn().mockRejectedValue(new Error('x')) });
		await activate(player, input({ clips: [clip('a')], deviceVoice: false }), 'ja');
		expect(player.speak).not.toHaveBeenCalled();
	});
	it('speaks when there are no clips and resolves when speech ends', async () => {
		const player = fakePlayer();
		player.speak.mockImplementation((_t: string, _l: string, done?: () => void) => {
			setTimeout(() => done?.(), 0);
			return true;
		});
		await activate(player, input(), 'zh');
		expect(player.speak).toHaveBeenCalledWith('風', 'zh', expect.any(Function));
	});
});

describe('entry audio helpers', () => {
	const res = (over: Partial<AudioResolution>): AudioResolution => ({ terms: [], syllables: null, ...over });
	it('headwordClips prefers the word clips, then the first complete syllable sequence', () => {
		expect(headwordClips(res({ terms: [clip('t')] }))).toEqual([clip('t')]);
		expect(headwordClips(res({ syllables: [[clip('s1'), clip('s2')], null] }))).toEqual([clip('s1'), clip('s2')]);
		expect(headwordClips(res({ syllables: [null] }))).toEqual([]);
		expect(headwordClips(null)).toEqual([]);
	});
	it('readingClips aligns syllable slots with the pinyin readings only', () => {
		const readings: Reading[] = [
			{ type: 'pinyin', value: 'xíng', plain: 'xing2', ord: 0 },
			{ type: 'bopomofo', value: 'ㄒㄧㄥˊ', plain: '', ord: 1 },
			{ type: 'pinyin', value: 'háng', plain: 'hang2', ord: 2 }
		];
		const audioFor = readingClips(res({ syllables: [[clip('x')], null] }), readings);
		expect(audioFor?.(readings[0], 0)).toEqual([clip('x')]);
		expect(audioFor?.(readings[1], 1)).toBeNull();
		expect(audioFor?.(readings[2], 2)).toBeNull();
	});
	it('readingClips is absent when the slots do not match the readings (an edited entry)', () => {
		const readings: Reading[] = [{ type: 'pinyin', value: 'xíng', plain: '', ord: 0 }];
		expect(readingClips(res({ syllables: [[clip('x')], [clip('y')]] }), readings)).toBeNull();
		expect(readingClips(res({ syllables: null }), readings)).toBeNull();
		expect(readingClips(null, readings)).toBeNull();
	});
});
