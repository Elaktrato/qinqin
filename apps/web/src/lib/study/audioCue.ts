import type { AudioResolution } from '../api/audio';
import type { Entry } from '../api/types';
import { headwordClips } from '../audio/button';
import { clipObjectUrl } from '../audio/source';
import type { ClipCache } from '../context/caches';
import type { AudioSettings } from '../audio/settings';
import type { AudioClip } from '../api/audio';

/** What a study card can play for its entry. */
export interface CardAudio {
	clips: AudioClip[];
	speakText: string;
	lang: string;
	deviceVoice: boolean;
}

/** cardAudio is the audio of a card's entry: its headword clips, with the device-voice fallback per the settings. */
export function cardAudio(entry: Entry, res: AudioResolution | null | undefined, settings: AudioSettings): CardAudio {
	return { clips: headwordClips(res ?? null), speakText: entry.written, lang: entry.language, deviceVoice: settings.deviceVoice };
}

/**
 * autoplayDue says whether the card should play on its own now: only once
 * the answer is revealed, only when the workspace setting is on, and once
 * per card (`playedFor` is the key of the card already played).
 */
export function autoplayDue(i: {
	done: boolean;
	autoplay: boolean;
	/** The session's recordings have been resolved (or will never be). */
	ready: boolean;
	playedFor: string | null;
	key: string;
}): boolean {
	return i.done && i.autoplay && i.ready && i.playedFor !== i.key;
}

/** isPlayKey is the study key `p` (the session only honours it after the reveal). */
export function isPlayKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
	return !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'p';
}

/** preloadClips warms the clip cache of a card that is about to be shown. */
export function preloadClips(clips: ClipCache, audio: CardAudio | null | undefined): void {
	for (const clip of audio?.clips ?? []) void clipObjectUrl(clips, clip.url).catch(() => {});
}
