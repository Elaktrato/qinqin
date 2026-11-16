// The place daily limits (item 4b, #89) plug into the decks page. Until 4b
// lands both exports are null: the settings view hides the section and the
// list and detail show no "left today". 4b replaces the values with its
// per-deck editor (rows `limits:deck:<deckId>`) and its remaining counts
// (`effectiveLimits` + `dayCounts`); nothing else on this page changes.

import type { Component } from 'svelte';

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

/** The per-deck limit control for DeckSettingsView, or null while 4b is not built. */
export const deckLimitsEditor: Component<DeckLimitsEditorProps> | null = null as Component<DeckLimitsEditorProps> | null;

/** What is left of today's limits for a deck, or null while 4b is not built. */
export const limitsLeftToday: ((deckId: string) => LimitsLeftToday) | null = null as ((deckId: string) => LimitsLeftToday) | null;
