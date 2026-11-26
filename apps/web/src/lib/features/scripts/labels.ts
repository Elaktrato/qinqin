// The words of the trainer's ids: catalogue text for each writing system, chart group, mastery and mode.

import { labelRecord } from '$lib/i18n';
import type { Mastery } from './chart';
import type { Mode, SystemId } from './types';

export const systemLabel = (id: string): string => (Object.hasOwn(SYSTEMS, id) ? SYSTEMS[id as SystemId] : id);
export const groupLabel = (id: string): string => (Object.hasOwn(GROUPS, id) ? GROUPS[id] : id);
export const masteryLabel = (m: Mastery): string => MASTERY[m];
export const modeLabel = (m: Mode): string => MODES[m];
export const modeHint = (m: Mode): string => MODE_HINTS[m];
export const keyboardNote = (id: string): string => (Object.hasOwn(KEYBOARD, id) ? KEYBOARD[id as SystemId] : '');
export const promptLabel = (m: Mode): string => PROMPTS[m];

const SYSTEMS = labelRecord({
	hiragana: 'scripts.system.hiragana',
	katakana: 'scripts.system.katakana',
	hangul: 'scripts.system.hangul',
	cyrillic: 'scripts.system.cyrillic'
} as const);

const GROUPS: Readonly<Record<string, string>> = labelRecord({
	basic: 'scripts.group.basic',
	dakuten: 'scripts.group.dakuten',
	handakuten: 'scripts.group.handakuten',
	combo: 'scripts.group.combo',
	consonant: 'scripts.group.consonant',
	tense: 'scripts.group.tense',
	vowel: 'scripts.group.vowel',
	compound: 'scripts.group.compound',
	signs: 'scripts.group.signs'
} as const);

const MASTERY = labelRecord({
	unseen: 'scripts.mastery.unseen',
	learning: 'scripts.mastery.learning',
	known: 'scripts.mastery.known'
} as const);

const MODES = labelRecord({
	recognise: 'scripts.mode.recognise',
	recall: 'scripts.mode.recall',
	read: 'scripts.mode.read',
	type: 'scripts.mode.type',
	write: 'scripts.mode.write'
} as const);

const MODE_HINTS = labelRecord({
	recognise: 'scripts.mode.recogniseHint',
	recall: 'scripts.mode.recallHint',
	read: 'scripts.mode.readHint',
	type: 'scripts.mode.typeHint',
	write: 'scripts.mode.writeHint'
} as const);

const PROMPTS = labelRecord({
	recognise: 'scripts.run.prompt.recognise',
	recall: 'scripts.run.prompt.recall',
	read: 'scripts.run.prompt.read',
	type: 'scripts.run.prompt.type',
	write: 'scripts.run.prompt.write'
} as const);

const KEYBOARD = labelRecord({
	hiragana: 'scripts.keyboard.hiragana',
	katakana: 'scripts.keyboard.katakana',
	hangul: 'scripts.keyboard.hangul',
	cyrillic: 'scripts.keyboard.cyrillic'
} as const);
