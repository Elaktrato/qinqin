// The core features: flashcards (Decks) and the reader. They are the app,
// not plugins (v0.4.0, #85): they are not in webPlugins, Settings -> Plugins
// never lists them, and their nav links come first. Each user can still
// switch one off for themselves: the switch is that user's state row of the
// reserved registry id (`GET /api/plugins`, `PUT /api/plugins/{id}/state`).
// Switching off only hides the nav link, the widgets and the page; the
// server keeps accepting and counting the feature's data and events.

import type { Component } from 'svelte';
import type { PluginInfo } from '$lib/api/types';
import { t, type MessageKey } from '$lib/i18n';
import { CORE_PLUGIN_ID } from '$lib/plugins/core/manifest';
import type { PluginManifest } from '$lib/plugins';
import FlashcardsPage from '$lib/features/flashcards/FlashcardsPage.svelte';
import { flashcardsManifest } from '$lib/features/flashcards/manifest';
import ReaderPage from '$lib/features/reader/ReaderPage.svelte';
import { readerManifest } from '$lib/features/reader/manifest';

export const FLASHCARDS_ID = 'qinqin-flashcards';
export const READER_ID = 'qinqin-reader';

/** Registry ids that are the app, not plugins: the core row and the two features. */
export const RESERVED_IDS: ReadonlySet<string> = new Set([CORE_PLUGIN_ID, FLASHCARDS_ID, READER_ID]);

export interface CoreFeature {
	id: string;
	/** The nav and page title (catalogue text, read when shown). */
	readonly title: string;
	/** The URL segment. */
	slug: string;
	href: string;
	/** Widgets and credits (the manifest the web build ships for the id). */
	manifest: PluginManifest;
	/** The page, which routes `rest` itself. */
	component: Component<{ rest: string }>;
}

export const coreFeatures: readonly CoreFeature[] = [
	{
		id: FLASHCARDS_ID,
		get title() {
			return t('features.flashcards.title');
		},
		slug: 'flashcards',
		href: '/flashcards',
		manifest: flashcardsManifest,
		component: FlashcardsPage
	},
	{
		id: READER_ID,
		get title() {
			return t('features.reader.title');
		},
		slug: 'reader',
		href: '/reader',
		manifest: readerManifest,
		component: ReaderPage
	}
];

/**
 * The heading of a switched-off feature's page: one whole message per feature (a label and a verb glued
 * together cannot be translated; spec Ruling).
 */
const SWITCHED_OFF: Readonly<Record<string, MessageKey>> = {
	[FLASHCARDS_ID]: 'features.flashcards.switchedOff',
	[READER_ID]: 'features.reader.switchedOff'
};

/** switchedOffTitle: "Flashcards are switched off" for a core feature id. */
export function switchedOffTitle(id: string): string {
	return t(SWITCHED_OFF[featureById(id).id]);
}

function stateOf(id: string, states: readonly PluginInfo[]): PluginInfo | undefined {
	return states.find((s) => s.id === id);
}

/** featureEnabled: the user's switch; a feature without a state row is on. */
export function featureEnabled(id: string, states: readonly PluginInfo[]): boolean {
	return stateOf(id, states)?.enabled ?? true;
}

/**
 * featureWidgets: the widgets of the features the server lists as on. As in
 * v0.3.0, a feature without a state row (no states loaded yet) shows none,
 * so a switched-off feature's widget never flashes in.
 */
export function featureWidgets(states: readonly PluginInfo[]) {
	return coreFeatures.flatMap((f) => (stateOf(f.id, states)?.enabled ? (f.manifest.widgets ?? []) : []));
}

/** featureById: the core feature of a reserved id. */
export function featureById(id: string): CoreFeature {
	const feature = coreFeatures.find((f) => f.id === id);
	if (feature === undefined) throw new Error(`not a core feature: ${id}`);
	return feature;
}

/** findFeature resolves a feature by its slug; a switched-off one is undefined. */
export function findFeature(slug: string, states: readonly PluginInfo[]): CoreFeature | undefined {
	return coreFeatures.find((f) => f.slug === slug && featureEnabled(f.id, states));
}

