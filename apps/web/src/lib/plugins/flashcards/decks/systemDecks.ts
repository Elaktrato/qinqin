// System decks: level decks of installed level packs and decks a plugin
// ships. They are computed, never stored (nothing to sync or migrate, a
// pack update shows at once, read-only by construction). Copying one into
// an owned deck uses the deterministic ids below, which every client
// derives identically (docs/contracts/decks/system-deck-ids.json).

import type { EntryBase, Scheme } from '$lib/api/types';
import type { DeckSource } from '$lib/study/types';

/** A deck a plugin ships: its items are entry ids. */
export interface SystemDeckDef {
	key: string;
	title: string;
	language: string;
	entryIds: number[];
}

export interface LevelDeck {
	kind: 'level';
	schemeId: number;
	packId: string;
	schemeName: string;
	unit: string;
	level: string;
	ord: number;
}

/** The level decks of the schemes installed for `language`: scheme order, then level order. */
export function levelDecks(schemes: readonly Scheme[], language: string): LevelDeck[] {
	const out: LevelDeck[] = [];
	for (const scheme of schemes) {
		if (scheme.language !== language) continue;
		const levels = [...scheme.levels].sort((a, b) => a.ord - b.ord || a.id - b.id);
		for (const level of levels) {
			out.push({
				kind: 'level',
				schemeId: scheme.id,
				packId: scheme.packId ?? `scheme-${scheme.id}`,
				schemeName: scheme.name,
				unit: scheme.unit,
				level: level.name,
				ord: level.ord
			});
		}
	}
	return out;
}

/** The entries a level deck studies: a character scheme keeps characters, every other scheme words. */
export function levelItems(deck: LevelDeck, entries: readonly EntryBase[]): EntryBase[] {
	const wanted = deck.unit === 'character' ? 'character' : 'word';
	const seen = new Set<number>();
	const out: EntryBase[] = [];
	for (const entry of entries) {
		if (entry.kind !== wanted || seen.has(entry.id)) continue;
		seen.add(entry.id);
		out.push(entry);
	}
	return out;
}

/** fnv1a32: FNV-1a over the UTF-8 of the NFC text, as 8 lower-case hex digits. */
export function fnv1a32(text: string): string {
	let hash = 0x811c9dc5;
	for (const byte of new TextEncoder().encode(text.normalize('NFC'))) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

/** slugId: lower case, every character outside [a-z0-9-] becomes '-'. */
export function slugId(text: string): string {
	return text.normalize('NFC').toLowerCase().replace(/[^a-z0-9-]/gu, '-');
}

/** The id of the owned copy of a level deck: `d-lvl-<slug(packId)>-<fnv1a32(packId NUL level)>`. */
export function ownedLevelDeckId(packId: string, level: string): string {
	return `d-lvl-${slugId(packId)}-${fnv1a32(`${packId}\u0000${level}`)}`;
}

/** The id of the owned copy of a plugin deck. */
export function ownedPluginDeckId(pluginId: string, key: string): string {
	return `d-plg-${slugId(pluginId)}-${fnv1a32(`${pluginId}\u0000${key}`)}`;
}

/**
 * The id of the owned copy of a starter deck (#75):
 * `d-frq-<slug(packId)>-<fnv1a32(packId NUL "top-" size)>`.
 */
export function ownedStarterDeckId(packId: string, size: number): string {
	return `d-frq-${slugId(packId)}-${fnv1a32(`${packId}\u0000top-${size}`)}`;
}

/** copiedFrom names the system deck a copy came from ("Copied from …"). */
export function copiedFrom(source: DeckSource): string {
	switch (source.type) {
		case 'level':
			return `${source.packId} · ${source.level}`;
		case 'plugin':
			return `${source.pluginId} · ${source.key}`;
		case 'frequency':
			return `${source.packId} · Top ${source.size}`;
	}
}
