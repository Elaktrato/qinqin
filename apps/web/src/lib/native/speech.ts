// The device voice in the shell: Android's own text-to-speech through the QinqinSpeech plugin. In a browser the
// speech synthesis of the page is used instead (lib/audio/player.ts) and nothing here does anything.
import { plugin } from './shell';

export interface SpeechPlugin {
	isAvailable(options: { lang: string }): Promise<{ available: boolean; engine?: boolean; tag?: string }>;
	speak(options: { text: string; lang: string; rate: number }): Promise<{ spoken: boolean }>;
	stop(): Promise<void>;
	openVoiceSettings(): Promise<void>;
}

/** Learners hear slightly slower speech (Ruling, plan 2026-11-25-native-features). */
export const SPEECH_RATE = 0.9;

/** ok: a voice is installed; missing: the engine answered and has none; unknown: not asked yet or no answer. */
export type VoiceState = 'ok' | 'missing' | 'unknown';

const speech = (): SpeechPlugin | null => plugin<SpeechPlugin>('QinqinSpeech');
const known = new Map<string, VoiceState>();
const key = (lang: string): string => lang.trim().toLowerCase().replace('_', '-');

/** resetSpeechCache forgets what was learned (tests, and a return from the voice settings). */
export function resetSpeechCache(): void {
	known.clear();
}

/** voiceState is what is known about a language's voice, without asking. 'unknown' outside the shell. */
export function voiceState(lang: string): VoiceState {
	return known.get(key(lang)) ?? 'unknown';
}

/** probeVoice asks the engine (once per language; a failed ask is not remembered). */
export async function probeVoice(lang: string): Promise<VoiceState> {
	const s = speech();
	if (s === null) return 'unknown';
	const have = known.get(key(lang));
	if (have !== undefined) return have;
	try {
		const r = await s.isAvailable({ lang });
		const state: VoiceState = r.available ? 'ok' : 'missing';
		known.set(key(lang), state);
		return state;
	} catch {
		return 'unknown';
	}
}

/** What the audio player needs of the shell's voice. */
export interface NativeSpeech {
	state(lang: string): VoiceState;
	/** Resolves true when the text was spoken to the end; false when it was interrupted or there is no voice. */
	speak(text: string, lang: string): Promise<boolean>;
	stop(): void;
}

/** nativeSpeech is the shell's voice, or null outside the shell. */
export function nativeSpeech(): NativeSpeech | null {
	const s = speech();
	if (s === null) return null;
	return {
		state: voiceState,
		async speak(text, lang) {
			try {
				return (await s.speak({ text, lang, rate: SPEECH_RATE })).spoken;
			} catch {
				known.set(key(lang), 'missing');
				return false;
			}
		},
		stop() {
			void Promise.resolve(s.stop()).catch(() => undefined);
		}
	};
}

/** openVoiceSettings opens Android's text-to-speech settings, where voice packs are installed. */
export async function openVoiceSettings(): Promise<void> {
	try {
		await speech()?.openVoiceSettings();
	} catch {
		// no settings screen: the hint text still names where to look
	}
}
