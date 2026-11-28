// Saved sentences (#279, docs/contracts/reader/saved-sentences.json): the
// book sentence a studied word is met in becomes an own sentence of the
// entry and a sentence (Word Salad) card of the word, from the popup's
// "Save this sentence" or, with the workspace's `reader.saveSentences` on,
// whenever such a word is looked up. No limit per word (owner).

import { compareCanonical } from '$lib/studycore/canonical';
import type { StudyCard } from '$lib/studycore/types';
import type { SentenceSourceRequest } from '$lib/api/types';
import { adoptSource, wantsSource, type SourcedSentence } from './sentence';

/** The contract's whitespace: a run of these is one space in a sentence's text. */
export const SENTENCE_SPACE: readonly string[] = [
	'\t', '\n', '\v', '\f', '\r', ' ', '\u0085', ' ', ' ',
	' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ',
	' ', ' ', ' ', ' ', '　', '﻿'
];

const SPACE_RUN = new RegExp(`[${SENTENCE_SPACE.map((ch) => `\\u{${ch.codePointAt(0)!.toString(16)}}`).join('')}]+`, 'gu');

/** normalizeSentence turns each whitespace run into one space and trims; nothing else is folded. */
export function normalizeSentence(text: string): string {
	return text.replace(SPACE_RUN, ' ').replace(/^ | $/gu, '');
}

/** sameSentence is the first sentence with the same normalised text, or null (an empty text matches nothing). */
export function sameSentence<T extends { id: number; hanzi: string }>(list: readonly T[], text: string): T | null {
	const wanted = normalizeSentence(text);
	if (wanted === '') return null;
	return list.find((s) => normalizeSentence(s.hanzi) === wanted) ?? null;
}

/** What a new sentence card takes from the word's canonical vocab card. */
export interface CardPart {
	deckIds: string[];
	written?: string;
}

export type SavePlan =
	| { action: 'none' }
	| { action: 'already'; sentenceId: number }
	| { action: 'card'; sentenceId: number; card: CardPart }
	| { action: 'save'; text: string; card: CardPart | null };

/**
 * planSentenceSave decides what saving `text` for the entry does, from the
 * sentences the learner sees on it and the workspace's cards (contract
 * `plan`).
 */
export function planSentenceSave({
	entryId,
	entryKind,
	text,
	sentences,
	cards
}: {
	entryId: number;
	entryKind: string;
	text: string;
	sentences: readonly { id: number; hanzi: string }[];
	cards: readonly StudyCard[];
}): SavePlan {
	const wanted = normalizeSentence(text);
	if (entryKind === 'character' || wanted === '') return { action: 'none' };
	const vocab = cards.filter((c) => c.kind === 'vocab' && c.entryId === entryId).sort(compareCanonical)[0];
	if (vocab === undefined) return { action: 'none' };
	const card: CardPart | null = vocab.skipKinds?.includes('sentence')
		? null
		: { deckIds: [...vocab.deckIds], ...(vocab.written !== undefined ? { written: vocab.written } : {}) };
	const same = sameSentence(sentences, wanted);
	if (same === null) return { action: 'save', text: wanted, card };
	const carded = cards.some((c) => c.kind === 'sentence' && c.entryId === entryId && c.sentenceId === same.id);
	if (carded || card === null) return { action: 'already', sentenceId: same.id };
	return { action: 'card', sentenceId: same.id, card };
}

/** Whether the workspace settings switch the automatic mode on (`reader.saveSentences`, default off). */
export function autoSaveOn(settings: Record<string, unknown> | null | undefined): boolean {
	const reader = settings?.reader;
	if (typeof reader !== 'object' || reader === null || Array.isArray(reader)) return false;
	return (reader as Record<string, unknown>).saveSentences === true;
}

/**
 * autoSaveApplies: the automatic mode runs for a popup result only when it
 * is on, the result is the root popup's first (the look-up the history
 * records) with its paragraph known, not a character, and the word was in
 * study when the popup opened (contract `auto`).
 */
export function autoSaveApplies(c: {
	settings: Record<string, unknown> | null | undefined;
	first: boolean;
	paragraph: boolean;
	entryKind: string;
	inStudyAtOpen: boolean;
}): boolean {
	return autoSaveOn(c.settings) && c.first && c.paragraph && c.entryKind !== 'character' && c.inStudyAtOpen;
}

/** The calls saveBookSentence makes (injected; the component passes the real ones). */
export interface SaveDeps {
	/** The workspace's live cards. */
	cards(workspaceId: number): Promise<readonly StudyCard[]>;
	getEntry(entryId: number): Promise<{ sentences?: readonly SourcedSentence[] | null }>;
	/** POST the text (with where it was read, #280); the server answers an existing sentence with the same text. */
	addSentence(entryId: number, hanzi: string, source?: SentenceSourceRequest): Promise<{ id: number }>;
	addCard(
		workspaceId: number,
		entryId: number,
		opts: { kind: 'sentence'; sentenceId: number; deckIds: string[]; written?: string }
	): Promise<unknown>;
}

export type SaveOutcome =
	| { outcome: 'none' }
	| { outcome: 'already'; sentenceId: number }
	| { outcome: 'saved'; sentenceId: number }
	| { outcome: 'savedNoCard'; sentenceId: number };

/**
 * saveBookSentence runs the plan: posts a new sentence and adds the card.
 * A failed read or write throws; nothing is half done except a posted
 * sentence whose card failed (saving again adds the card: `card`).
 */
export async function saveBookSentence(
	deps: SaveDeps,
	req: { workspaceId: number; entryId: number; entryKind: string; text: string; source?: SentenceSourceRequest }
): Promise<SaveOutcome> {
	if (req.entryKind === 'character' || normalizeSentence(req.text) === '') return { outcome: 'none' };
	const cards = await deps.cards(req.workspaceId);
	const pre = planSentenceSave({ ...req, sentences: [], cards });
	if (pre.action === 'none') return { outcome: 'none' };
	const entry = await deps.getEntry(req.entryId);
	const plan = planSentenceSave({ ...req, sentences: entry.sentences ?? [], cards });
	// The same text already on the entry: an own sentence without a source takes this one (#280).
	if ((plan.action === 'card' || plan.action === 'already') && req.source) {
		const same = (entry.sentences ?? []).find((s) => s.id === plan.sentenceId);
		if (same && wantsSource(same, req.source)) await adoptSource(deps, req.entryId, normalizeSentence(req.text), req.source);
	}
	switch (plan.action) {
		case 'none':
			return { outcome: 'none' };
		case 'already':
			return { outcome: 'already', sentenceId: plan.sentenceId };
		case 'card':
			await deps.addCard(req.workspaceId, req.entryId, { kind: 'sentence', sentenceId: plan.sentenceId, ...plan.card });
			return { outcome: 'saved', sentenceId: plan.sentenceId };
		case 'save': {
			const created = req.source
				? await deps.addSentence(req.entryId, plan.text, req.source)
				: await deps.addSentence(req.entryId, plan.text);
			if (plan.card === null) return { outcome: 'savedNoCard', sentenceId: created.id };
			await deps.addCard(req.workspaceId, req.entryId, { kind: 'sentence', sentenceId: created.id, ...plan.card });
			return { outcome: 'saved', sentenceId: created.id };
		}
	}
}
