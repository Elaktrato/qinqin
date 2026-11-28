// The place daily limits (#89) plug into the decks page: the per-deck editor
// for DeckSettingsView and the "left today" numbers of the list and detail.

import type { Component } from 'svelte';
import DeckLimitsEditor from '$lib/settings/DeckLimitsEditor.svelte';
import type { StudyCardKind } from '$lib/studycore/types';
import { deckLeftToday, type LeftInput } from './deckLimits';

export interface DeckLimitsEditorProps {
	deckId: string;
	deckName: string;
}

export interface LimitsLeftToday {
	/** New cards still allowed today; null = unlimited. */
	new: number | null;
	/** Reviews still allowed today; null = unlimited. */
	reviews: number | null;
}

/** The per-deck limit control for DeckSettingsView (rows `limits:deck:<deckId>`). */
export const deckLimitsEditor: Component<DeckLimitsEditorProps> | null = DeckLimitsEditor;

/** What is left of today's limits for a deck (the decks snapshot and the deck's kinds). */
export const limitsLeftToday:
	| ((deckId: string, data: LeftInput, kinds: readonly StudyCardKind[]) => LimitsLeftToday)
	| null = (deckId, data, kinds) => deckLeftToday(data, deckId, kinds);
