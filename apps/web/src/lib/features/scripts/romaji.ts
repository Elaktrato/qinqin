// Hidden romaji in the writing-system trainer (#284): with the workspace's romaji switch on Never, the kana charts
// hide the romaji labels (a cell's detail, opened by a tap, still says it), the sound prompts (Recall, Type, Write)
// play the sound and keep the romaji behind a "Show romaji" hint, and the modes that answer by choosing a romaji
// (Recognise, Read) are not offered. Hangul and Cyrillic have no romaji switch.

import type { Mode, SystemId } from './types';

/** The modes whose answer is a romaji the learner picks. */
export const ROMAJI_ANSWER_MODES: readonly Mode[] = ['recognise', 'read'];

/** hidesRomaji: the system is kana and the workspace hides romaji (`shows`: useRomanisation().shows). */
export function hidesRomaji(system: SystemId, shows: (type: string) => boolean): boolean {
	return (system === 'hiragana' || system === 'katakana') && !shows('romaji');
}

/** practiceModes: the modes offered, without the romaji-answer ones while romaji is hidden. */
export function practiceModes(modes: readonly Mode[], hidden: boolean): Mode[] {
	return hidden ? modes.filter((m) => !ROMAJI_ANSWER_MODES.includes(m)) : [...modes];
}
