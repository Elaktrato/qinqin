// The words of the tone-pair drill (#180): each of the 20 pairs practises real two-syllable words with its pattern
// (docs/contracts/tones/pairs.json `words`), the learner's deck words first, then the installed HSK word list read
// through the server, level by level. Nothing is bundled.

import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
import { loadEntryBases } from '$lib/api/entryBases';
import type { EntryBase, Reading, Scheme } from '$lib/api/types';
import { pairKeyOf, TONE_PAIRS } from '$lib/exercises/tonePairs';
import type { DrillAnswer } from '$lib/studycore/drills';
import type { StudyCard } from '$lib/studycore/types';
import type { Session } from '$lib/context/session.svelte';
import type { DrillItem } from '../types';

export const TONE_PAIRS_DRILL = 'tone-pairs';

/** The words a pair keeps from the level list (deck words always count, up to MAX_DECK_WORDS). */
export const PAIR_WORDS = 12;
export const MAX_DECK_WORDS = 50;
/** The most levels read (the lowest first): HSK 1–4 give every pattern. */
export const MAX_LEVELS = 4;

/** One word a pair practises. */
export interface PairWord {
	entryId: number;
	written: string;
	language: string;
	/** Its pinyin readings (the verdict's candidates). */
	readings: Reading[];
	/** From the learner's decks (else the level list). */
	fromDeck: boolean;
}

/** What an item of the drill carries: its words and the one this question asks. */
export interface PairItemData {
	words: PairWord[];
	/** The index of the word asked (the pair's answers so far, modulo its words). */
	next: number;
}

export type PairWords = Map<string, PairWord[]>;

function wordOf(base: EntryBase, fromDeck: boolean): { key: string; word: PairWord } | null {
	const key = pairKeyOf(base.written, base.readings);
	if (key === null) return null;
	const readings = base.readings.filter((r) => r.type === 'pinyin');
	return { key, word: { entryId: base.id, written: base.written, language: base.language, readings, fromDeck } };
}

/**
 * addWords sorts entries into their pairs, in the given order, each entry once: deck words up to MAX_DECK_WORDS a
 * pair, level words until a pair has PAIR_WORDS.
 */
export function addWords(into: PairWords, bases: readonly EntryBase[], fromDeck: boolean): PairWords {
	const seen = new Set([...into.values()].flat().map((w) => w.entryId));
	for (const base of bases) {
		if (seen.has(base.id)) continue;
		const found = wordOf(base, fromDeck);
		if (found === null) continue;
		const list = into.get(found.key) ?? [];
		if (list.length >= (fromDeck ? MAX_DECK_WORDS : PAIR_WORDS)) continue;
		list.push(found.word);
		into.set(found.key, list);
		seen.add(base.id);
	}
	return into;
}

/** full: every pair has PAIR_WORDS words. */
export function full(words: PairWords): boolean {
	return TONE_PAIRS.every((key) => (words.get(key)?.length ?? 0) >= PAIR_WORDS);
}

/**
 * wordScheme: the level list the drill reads in a language: `hsk-words`, else another `hsk-` pack, else any
 * word-unit level pack of the language (the system decks' exact language match); null without one.
 */
export function wordScheme(schemes: readonly Scheme[], language: string): Scheme | null {
	const words = schemes.filter((s) => s.language === language && s.unit === 'word' && s.levels.length > 0);
	return (
		words.find((s) => s.packId === 'hsk-words') ??
		words.find((s) => s.packId?.startsWith('hsk-') === true) ??
		words[0] ??
		null
	);
}

/** deckEntryIds: the entries of the workspace's cards, in card creation order, each once; snapshots of another length skipped. */
export function deckEntryIds(cards: readonly StudyCard[]): number[] {
	const sorted = [...cards].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
	const ids: number[] = [];
	const seen = new Set<number>();
	for (const card of sorted) {
		if (seen.has(card.entryId)) continue;
		seen.add(card.entryId);
		if (card.written !== undefined && [...card.written].length !== 2) continue;
		ids.push(card.entryId);
	}
	return ids;
}

/**
 * levelWords: the level list's pair words of a language, the lowest levels first, at most MAX_LEVELS levels and
 * only until every pair is full; kept for the session (a failure is not kept: the drill then has the deck words).
 */
export function levelWords(session: Session, language: string): Promise<PairWords> {
	const cache = session.caches.tonePairWords;
	const hit = cache.get(language);
	if (hit !== undefined) return hit;
	const loading = (async () => {
		const scheme = wordScheme(await getSchemes(), language);
		const words: PairWords = new Map();
		if (scheme === null) return words;
		const levels = [...scheme.levels].sort((a, b) => a.ord - b.ord || a.id - b.id).slice(0, MAX_LEVELS);
		for (const level of levels) {
			addWords(words, await getSchemeEntries(scheme.id, level.name), false);
			if (full(words)) break;
		}
		return words;
	})();
	cache.set(language, loading);
	loading.catch(() => {
		if (cache.get(language) === loading) cache.delete(language);
	});
	return loading;
}

/** pairItems: the candidate items, in grid order, each pair with words: deck words first, then level words. */
export function pairItems(deck: PairWords, level: PairWords, answers: readonly DrillAnswer[]): DrillItem<PairItemData>[] {
	const count = new Map<string, number>();
	for (const a of answers) if (a.drill === TONE_PAIRS_DRILL) count.set(a.item, (count.get(a.item) ?? 0) + 1);
	const out: DrillItem<PairItemData>[] = [];
	for (const key of TONE_PAIRS) {
		const words = [...(deck.get(key) ?? [])];
		const ids = new Set(words.map((w) => w.entryId));
		for (const w of level.get(key) ?? []) if (!ids.has(w.entryId)) words.push(w);
		if (words.length === 0) continue;
		out.push({ key, data: { words, next: (count.get(key) ?? 0) % words.length } });
	}
	return out;
}

/** loadPairItems: the drill's items for a workspace (its cards' words, then the level list's). */
export async function loadPairItems(
	session: Session,
	language: string,
	cards: readonly StudyCard[],
	answers: readonly DrillAnswer[]
): Promise<DrillItem<PairItemData>[]> {
	const [bases, level] = await Promise.all([
		loadEntryBases(session.caches.entryBases, deckEntryIds(cards)),
		levelWords(session, language).catch((): PairWords => new Map())
	]);
	const ordered = deckEntryIds(cards)
		.map((id) => bases.get(id))
		.filter((b): b is EntryBase => b !== undefined);
	return pairItems(addWords(new Map(), ordered, true), level, answers);
}
