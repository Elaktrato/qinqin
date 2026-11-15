import { describe, expect, it, vi } from 'vitest';
import { createPlayer, deviceVoiceFor } from './player';
import type { AudioClip } from '../api/audio';

const clip = (n: string): AudioClip => ({ url: `/c/${n}.opus`, packId: 'p', license: 'CC0', attribution: 'A', source: '' });

// A fake audio element: records what it was asked to do; tests end clips by hand.
class FakeAudio {
	src = '';
	log: string[] = [];
	private listeners = new Map<string, Set<() => void>>();
	addEventListener(type: string, fn: () => void) {
		if (!this.listeners.has(type)) this.listeners.set(type, new Set());
		this.listeners.get(type)!.add(fn);
	}
	removeEventListener(type: string, fn: () => void) {
		this.listeners.get(type)?.delete(fn);
	}
	play() {
		this.log.push(`play ${this.src}`);
		return Promise.resolve();
	}
	pause() {
		this.log.push('pause');
	}
	fire(type: string) {
		for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
	}
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('createPlayer', () => {
	it('plays a sequence in order, one clip after the other', async () => {
		const el = new FakeAudio();
		const p = createPlayer(() => el as unknown as HTMLAudioElement);
		const done = p.play([clip('a'), clip('b')]);
		await tick();
		expect(el.log).toEqual(['play /c/a.opus']);
		expect(p.playing).toBe(true);
		el.fire('ended');
		await tick();
		expect(el.log.at(-1)).toBe('play /c/b.opus');
		el.fire('ended');
		await done;
		expect(p.playing).toBe(false);
	});

	it('a second play stops the first: no overlap, the first never advances', async () => {
		const el = new FakeAudio();
		const p = createPlayer(() => el as unknown as HTMLAudioElement);
		const first = p.play([clip('a'), clip('b')]);
		await tick();
		const second = p.play([clip('c')]);
		await first; // superseded: resolves quietly
		await tick();
		expect(el.log.filter((l) => l.startsWith('play'))).toEqual(['play /c/a.opus', 'play /c/c.opus']);
		el.fire('ended'); // the clip that is actually playing ends
		await second;
		expect(el.log.filter((l) => l.startsWith('play'))).toEqual(['play /c/a.opus', 'play /c/c.opus']);
		expect(p.playing).toBe(false);
	});

	it('stop ends the sequence and cancels speech', async () => {
		const el = new FakeAudio();
		const cancel = vi.fn();
		const p = createPlayer(() => el as unknown as HTMLAudioElement, { cancel, getVoices: () => [], speak: vi.fn() } as unknown as SpeechSynthesis);
		const done = p.play([clip('a'), clip('b')]);
		await tick();
		p.stop();
		await done;
		el.fire('ended');
		await tick();
		expect(el.log.filter((l) => l.startsWith('play'))).toEqual(['play /c/a.opus']);
		expect(cancel).toHaveBeenCalled();
		expect(p.playing).toBe(false);
	});

	it('rejects when a clip fails, so the caller can fall back', async () => {
		const el = new FakeAudio();
		const p = createPlayer(() => el as unknown as HTMLAudioElement);
		const done = p.play([clip('a')]);
		await tick();
		el.fire('error');
		await expect(done).rejects.toThrow();
		expect(p.playing).toBe(false);
	});

	it('speak uses a matching device voice and reports false without one', () => {
		const spoken: { text: string; voice: unknown; lang: string }[] = [];
		const voices = [{ lang: 'en-US' }, { lang: 'zh-TW' }] as SpeechSynthesisVoice[];
		const synth = { getVoices: () => voices, speak: (u: unknown) => spoken.push(u as never), cancel: vi.fn() } as unknown as SpeechSynthesis;
		vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; voice: unknown = null; lang = ''; constructor(t: string) { this.text = t; } });
		const p = createPlayer(() => new FakeAudio() as unknown as HTMLAudioElement, synth);
		expect(p.speak('你好', 'zh')).toBe(true);
		expect(spoken).toHaveLength(1);
		expect(spoken[0].voice).toBe(voices[1]);
		expect(p.speak('こんにちは', 'ja')).toBe(false);
		const none = createPlayer(() => new FakeAudio() as unknown as HTMLAudioElement, null);
		expect(none.speak('你好', 'zh')).toBe(false);
		vi.unstubAllGlobals();
	});
});

describe('createPlayer with a source resolver', () => {
	it('plays the resolved source, and a play superseded while resolving never starts', async () => {
		const el = new FakeAudio();
		const gates: Record<string, () => void> = {};
		const resolveSrc = (url: string) => new Promise<string>((r) => (gates[url] = () => r(`blob:${url}`)));
		const p = createPlayer(() => el as unknown as HTMLAudioElement, null, resolveSrc);
		const first = p.play([clip('a')]);
		const second = p.play([clip('b')]);
		gates['/c/a.opus']();
		gates['/c/b.opus']();
		await tick();
		await first;
		expect(el.log.filter((l) => l.startsWith('play'))).toEqual(['play blob:/c/b.opus']);
		el.fire('ended');
		await second;
	});

	it('rejects when the source cannot be resolved', async () => {
		const p = createPlayer(() => new FakeAudio() as unknown as HTMLAudioElement, null, () => Promise.reject(new Error('401')));
		await expect(p.play([clip('a')])).rejects.toThrow('401');
		expect(p.playing).toBe(false);
	});
});

describe('speak end callback', () => {
	it('calls onEnd when the utterance ends or fails', () => {
		const utterances: { onend?: () => void; onerror?: () => void }[] = [];
		const synth = {
			getVoices: () => [{ lang: 'ja-JP' }],
			speak: (u: never) => utterances.push(u),
			cancel: vi.fn()
		} as unknown as SpeechSynthesisVoice[] & SpeechSynthesis;
		vi.stubGlobal('SpeechSynthesisUtterance', class { voice: unknown = null; lang = ''; constructor(public text: string) {} });
		const p = createPlayer(() => new FakeAudio() as unknown as HTMLAudioElement, synth);
		const ended = vi.fn();
		expect(p.speak('風', 'ja', ended)).toBe(true);
		expect(p.playing).toBe(true);
		utterances[0].onend?.();
		expect(ended).toHaveBeenCalledTimes(1);
		expect(p.playing).toBe(false);
		vi.unstubAllGlobals();
	});
});

describe('deviceVoiceFor', () => {
	const v = (lang: string) => ({ lang }) as SpeechSynthesisVoice;
	it('takes a voice of the language, preferring zh-CN and ja-JP', () => {
		expect(deviceVoiceFor('zh', [v('en-US'), v('zh-TW')])?.lang).toBe('zh-TW');
		expect(deviceVoiceFor('zh', [v('zh-TW'), v('zh-CN')])?.lang).toBe('zh-CN');
		expect(deviceVoiceFor('zh', [v('zh_CN')])?.lang).toBe('zh_CN');
		expect(deviceVoiceFor('ja', [v('ja-JP')])?.lang).toBe('ja-JP');
	});
	it('is null when no voice speaks the language', () => {
		expect(deviceVoiceFor('zh', [v('en-US'), v('ja-JP')])).toBeNull();
		expect(deviceVoiceFor('zh', [])).toBeNull();
		expect(deviceVoiceFor('es', [v('ja-JP')])).toBeNull();
	});
});
