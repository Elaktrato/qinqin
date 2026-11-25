import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeSpeech, openVoiceSettings, probeVoice, resetSpeechCache, SPEECH_RATE, voiceState } from './speech';

const win = window as unknown as { Capacitor?: unknown };

afterEach(() => {
	delete win.Capacitor;
	resetSpeechCache();
});

function shell(speech: Record<string, unknown>) {
	win.Capacitor = { isNativePlatform: () => true, Plugins: { QinqinSpeech: speech } };
}

describe('device voice in a normal browser', () => {
	it('is absent and does nothing', async () => {
		expect(nativeSpeech()).toBeNull();
		expect(voiceState('zh')).toBe('unknown');
		expect(await probeVoice('zh')).toBe('unknown');
		await expect(openVoiceSettings()).resolves.toBeUndefined();
	});
});

describe('device voice in the shell', () => {
	it('asks the engine once per language and remembers the answer', async () => {
		const isAvailable = vi.fn(async ({ lang }: { lang: string }) => ({ available: lang === 'zh', engine: true }));
		shell({ isAvailable });
		expect(voiceState('zh')).toBe('unknown');
		expect(await probeVoice('zh')).toBe('ok');
		expect(await probeVoice('ja')).toBe('missing');
		expect(voiceState('zh')).toBe('ok');
		expect(voiceState('ja')).toBe('missing');
		await probeVoice('zh');
		expect(isAvailable).toHaveBeenCalledTimes(2);
	});

	it('a failing engine query is unknown, not missing, and is asked again', async () => {
		const isAvailable = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ available: true });
		shell({ isAvailable });
		expect(await probeVoice('ja')).toBe('unknown');
		expect(await probeVoice('ja')).toBe('ok');
	});

	it('speaks at the learner rate and reports whether it was spoken', async () => {
		const speak = vi.fn(async () => ({ spoken: true }));
		shell({ isAvailable: async () => ({ available: true }), speak });
		const s = nativeSpeech();
		expect(await s?.speak('你好', 'zh')).toBe(true);
		expect(speak).toHaveBeenCalledWith({ text: '你好', lang: 'zh', rate: SPEECH_RATE });
	});

	it('a missing voice on speak marks the language missing', async () => {
		shell({ isAvailable: async () => ({ available: true }), speak: vi.fn().mockRejectedValue(new Error('no voice')) });
		const s = nativeSpeech();
		expect(await s?.speak('你好', 'zh')).toBe(false);
		expect(voiceState('zh')).toBe('missing');
	});

	it('stop and the settings screen go to the plugin', async () => {
		const stop = vi.fn(async () => undefined);
		const open = vi.fn(async () => undefined);
		shell({ stop, openVoiceSettings: open });
		nativeSpeech()?.stop();
		await openVoiceSettings();
		expect(stop).toHaveBeenCalled();
		expect(open).toHaveBeenCalled();
	});
});
