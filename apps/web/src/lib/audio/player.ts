import type { AudioClip } from '../api/audio';

export interface Player {
	/**
	 * Plays the clips one after the other. A newer play, speak or stop ends
	 * this one (the promise then resolves quietly). Rejects when a clip
	 * cannot be played, so the caller can fall back to the device voice.
	 */
	play(clips: AudioClip[]): Promise<void>;
	/** Speaks text with a device voice of lang; false when there is none. onEnd runs when the speech ends or is interrupted. */
	speak(text: string, lang: string, onEnd?: () => void): boolean;
	/** Stops whatever is playing, recordings and speech. */
	stop(): void;
	readonly playing: boolean;
}

/**
 * deviceVoiceFor picks the voice for a language code ("zh", "ja"): any voice
 * whose language starts with it, preferring zh-CN and ja-JP; null when the
 * device has none.
 */
export function deviceVoiceFor(lang: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
	const code = lang.toLowerCase().split(/[-_]/)[0];
	const norm = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace('_', '-');
	const matching = voices.filter((v) => norm(v).split('-')[0] === code);
	const preferred = code === 'zh' ? 'zh-cn' : code === 'ja' ? 'ja-jp' : '';
	return matching.find((v) => norm(v) === preferred) ?? matching[0] ?? null;
}

/**
 * createPlayer makes the shared player: one audio element, so two sounds can
 * never overlap. `make` builds the element (tests pass a fake), `synth` is the
 * speech synthesis to use (default the browser's, null for none).
 * `resolveSrc` turns a clip URL into what the element plays (the app fetches
 * the clip with the bearer token and passes an object URL; the default is
 * the URL itself).
 */
export function createPlayer(
	make: () => HTMLAudioElement = () => new Audio(),
	synth: SpeechSynthesis | null | undefined = typeof speechSynthesis === 'undefined' ? null : speechSynthesis,
	resolveSrc: (clipUrl: string) => Promise<string> = (url) => Promise.resolve(url)
): Player {
	let el: HTMLAudioElement | null = null;
	let abort: (() => void) | null = null;
	let busy = false;
	// The token of the sequence or utterance that is current; a newer call
	// replaces it, which is how a superseded loop knows to stop.
	let current: object | null = null;

	function cancel() {
		const a = abort;
		abort = null;
		a?.();
		el?.pause();
		synth?.cancel();
		busy = false;
	}

	// waitFor resolves when the element fires `ended`, rejects on `error`, and
	// resolves false when the sequence is cancelled.
	function waitFor(audio: HTMLAudioElement): Promise<boolean> {
		return new Promise((resolve, reject) => {
			const done = () => {
				cleanup();
				resolve(true);
			};
			const fail = () => {
				cleanup();
				reject(new Error('audio clip failed to play'));
			};
			const cleanup = () => {
				audio.removeEventListener('ended', done);
				audio.removeEventListener('error', fail);
				abort = null;
			};
			audio.addEventListener('ended', done);
			audio.addEventListener('error', fail);
			abort = () => {
				cleanup();
				resolve(false);
			};
		});
	}

	return {
		get playing() {
			return busy;
		},
		async play(clips) {
			cancel();
			if (clips.length === 0) return;
			el ??= make();
			const audio = el;
			busy = true;
			const mine = {};
			current = mine;
			try {
				for (const clip of clips) {
					const src = await resolveSrc(clip.url);
					if (current !== mine) return;
					audio.src = src;
					const ended = waitFor(audio);
					try {
						await audio.play();
					} catch (e) {
						abort?.();
						await ended;
						throw e;
					}
					if (!(await ended)) return; // cancelled by a newer call
				}
			} finally {
				if (current === mine) {
					current = null;
					busy = false;
				}
			}
		},
		speak(text, lang, onEnd) {
			if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return false;
			const voice = deviceVoiceFor(lang, synth.getVoices());
			if (!voice) return false;
			cancel();
			const u = new SpeechSynthesisUtterance(text);
			u.voice = voice;
			u.lang = voice.lang;
			busy = true;
			const mine = {};
			current = mine;
			const finish = () => {
				if (current === mine) {
					current = null;
					busy = false;
				}
			};
			const end = () => {
				finish();
				onEnd?.();
			};
			u.onend = end;
			u.onerror = end;
			synth.speak(u);
			return true;
		},
		stop() {
			current = null;
			cancel();
		}
	};
}
