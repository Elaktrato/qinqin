// The script data (CC0, project-written; ./data/ATTRIBUTION.md) as ScriptSystems. The JSON files are part of the
// web build, so the trainer works offline in the PWA and the Android shell (spec 2026-11-26, Ruling).

import kana from './data/kana.json';
import hangul from './data/hangul.json';
import cyrillic from './data/cyrillic.json';
import { SYSTEM_IDS, type ScriptItem, type ScriptSystem, type SystemId } from './types';

interface RawItem {
	glyph: string;
	lower?: string;
	roman: string;
	alt?: string[];
	group: string;
	sound?: string;
	key?: string;
	note?: string;
	lookalike?: boolean;
}

interface RawSystem {
	id: string;
	language: string;
	groups: string[];
	items: RawItem[];
	words: { text: string; roman: string; gloss: string }[];
}

/** buildSystem turns one raw system into the trainer's shape. */
export function buildSystem(raw: RawSystem): ScriptSystem {
	const id = raw.id as SystemId;
	if (!SYSTEM_IDS.includes(id)) throw new Error(`unknown writing system: ${raw.id}`);
	const items: ScriptItem[] = raw.items.map((r) => ({
		id: `${id}:${r.glyph}`,
		glyph: r.glyph,
		...(r.lower === undefined ? {} : { lower: r.lower }),
		roman: r.roman,
		sounds: [...new Set([r.roman, ...r.roman.split('/').filter((s) => s !== '' && s !== '-'), ...(r.alt ?? [])])],
		group: r.group,
		sound: r.sound ?? r.glyph,
		...(r.key === undefined ? {} : { key: r.key }),
		...(r.note === undefined ? {} : { note: r.note }),
		...(r.lookalike === true ? { lookalike: true } : {})
	}));
	return { id, language: raw.language, groups: raw.groups, items, words: raw.words };
}

const ALL: readonly ScriptSystem[] = [...kana.systems, ...hangul.systems, ...cyrillic.systems].map(buildSystem);

/** The writing systems of a language by the language profile's list (`writingSystems`), in that order. */
export function systemsFor(ids: readonly string[]): ScriptSystem[] {
	return ids.flatMap((id) => ALL.filter((s) => s.id === id));
}

export function systemById(id: string): ScriptSystem | undefined {
	return ALL.find((s) => s.id === id);
}

export function allSystems(): readonly ScriptSystem[] {
	return ALL;
}
