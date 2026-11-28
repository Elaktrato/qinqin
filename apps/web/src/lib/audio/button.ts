import { t } from '../i18n';
import type { AudioClip, AudioResolution } from '../api/audio';
import type { Reading } from '../api/types';
import { hasDeviceVoice, type Player } from './player';
import type { CardAudio } from './cue';

export interface ButtonInput {
	clips: AudioClip[];
	/** What the device voice says when there is no clip (or a clip fails). */
	speakText?: string;
	deviceVoice: boolean;
	/** Whether this device has a voice for the language (known only in the browser). */
	voiceAvailable: boolean;
}

export interface ButtonState {
	visible: boolean;
	mode: 'clips' | 'voice';
	title: string;
}

/** creditLine is the credit of the clips: each distinct "attribution · licence" once, "" for none. */
export function creditLine(clips: AudioClip[]): string {
	const seen: string[] = [];
	for (const c of clips) {
		const credit = c.attribution.includes(c.license) ? c.attribution : `${c.attribution} · ${c.license}`;
		if (!seen.includes(credit)) seen.push(credit);
	}
	return seen.length ? t('common.audio.credit', { credits: seen.join('; ') }) : '';
}

/**
 * buttonState decides whether a play button exists at all. It is visible
 * with at least one clip, or with the device voice on, text to speak and a
 * voice for the language — never a button that cannot make a sound.
 */
export function buttonState(i: ButtonInput): ButtonState {
	if (i.clips.length > 0) return { visible: true, mode: 'clips', title: creditLine(i.clips) };
	const voice = i.deviceVoice && !!i.speakText && i.voiceAvailable;
	return { visible: voice, mode: 'voice', title: t('common.audio.deviceVoice') };
}

/**
 * activate plays what the button stands for and resolves when it is done
 * (or superseded). A clip that fails falls back to the device voice when
 * that is allowed.
 */
export async function activate(
	player: Player,
	i: Pick<ButtonInput, 'clips' | 'speakText' | 'deviceVoice'>,
	lang: string
): Promise<void> {
	const speakAvailable = i.deviceVoice && !!i.speakText;
	const speak = () =>
		new Promise<void>((resolve) => {
			if (!player.speak(i.speakText ?? '', lang, resolve)) resolve();
		});
	if (i.clips.length > 0) {
		try {
			await player.play(i.clips);
		} catch {
			if (speakAvailable) await speak();
		}
		return;
	}
	if (speakAvailable) await speak();
}

/** headwordClips is what the headword button plays: the word's recordings, else the first complete syllable sequence. */
export function headwordClips(r: AudioResolution | null): AudioClip[] {
	if (!r) return [];
	if (r.terms.length > 0) return r.terms;
	return r.syllables?.find((s): s is AudioClip[] => s !== null && s.length > 0) ?? [];
}

/**
 * readingClips returns the per-reading lookup for Readings.svelte: the
 * syllable slots of the resolution are aligned with the entry's pinyin
 * readings, so a reading's slot is its index among the pinyin readings.
 * It is null when there are no slots or their count differs from the
 * pinyin readings shown (the caller's edit changed them), so a wrong clip
 * is never offered.
 */
export function readingClips(
	r: AudioResolution | null,
	readings: Reading[]
): ((reading: Reading, index: number) => AudioClip[] | null) | null {
	const slots = r?.syllables;
	if (!slots) return null;
	const ordered = [...readings].sort((a, b) => a.ord - b.ord);
	const pinyin = ordered.filter((x) => x.type === 'pinyin');
	if (pinyin.length !== slots.length) return null;
	return (reading) => {
		const slot = pinyin.indexOf(reading);
		return slot >= 0 ? (slots[slot] ?? null) : null;
	};
}

/** playLabel is the accessible name of a play button: it says what it pronounces. */
export function playLabel(what: string | undefined): string {
	return what ? t('common.audio.playNamed', { what }) : t('common.audio.play');
}

/**
 * canSound says whether pressing play on a card would make a sound: a clip, or
 * the device voice switched on with text to speak and a voice for the language.
 * `voices` defaults to the browser's.
 */
export function canSound(
	audio: CardAudio | null | undefined,
	voices: SpeechSynthesisVoice[] = typeof speechSynthesis === 'undefined' ? [] : speechSynthesis.getVoices()
): boolean {
	if (!audio) return false;
	if (audio.clips.length > 0) return true;
	return audio.deviceVoice && audio.speakText !== '' && hasDeviceVoice(audio.lang, voices);
}
