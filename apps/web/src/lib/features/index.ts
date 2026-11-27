// The core features: flashcards (Decks), the reader, the journal, grammar, the writing-system trainer (scripts, #204)
// and Stats (#295).
// They are the app (record 0006, #199): there are no code plugins. Each user
// can switch one off for themselves (GET /api/features, PUT
// /api/features/{id}; docs/contracts/features/). Switching off only hides the
// nav link, the widgets and the page; the server keeps accepting and
// counting the feature's data and events.

import type { Component } from 'svelte';
import { t, type MessageKey } from '$lib/i18n';
import type { SourceCredit } from '$lib/sources/credits';
import type { WidgetDef } from '$lib/widgets/types';
import FlashcardsPage from '$lib/features/flashcards/FlashcardsPage.svelte';
import { flashcardsDef } from '$lib/features/flashcards/manifest';
import ReaderPage from '$lib/features/reader/ReaderPage.svelte';
import { readerDef } from '$lib/features/reader/manifest';
import JournalPage from '$lib/features/journal/JournalPage.svelte';
import { journalDef } from '$lib/features/journal/manifest';
import GrammarPage from '$lib/features/grammar/GrammarPage.svelte';
import { grammarDef } from '$lib/features/grammar/manifest';
import ScriptsPage from '$lib/features/scripts/ScriptsPage.svelte';
import { scriptsDef } from '$lib/features/scripts/manifest';
import { statsDef } from '$lib/stats/manifest';
import { writingSystemsOf } from '$lib/languages/profiles';
import type { FeatureSwitch, FeatureSwitchesValue } from './switches.svelte';

export const FLASHCARDS_ID = 'flashcards';
export const READER_ID = 'reader';
export const JOURNAL_ID = 'journal';
export const GRAMMAR_ID = 'grammar';
export const SCRIPTS_ID = 'scripts';
export const STATS_ID = 'stats';

/** What the web build ships for a feature besides its page: widgets and third-party credits. */
export interface FeatureDef {
	/** Stats and home widgets; they exist only while the feature is on (lib/widgets/registry.ts). */
	widgets?: WidgetDef[];
	/** Third-party material the feature ships or fetches, credited on the Sources page. */
	sources?: SourceCredit[];
}

export interface CoreFeature {
	id: string;
	/** The nav and page title (catalogue text, read when shown). */
	readonly title: string;
	/** The URL segment. */
	slug: string;
	href: string;
	/** Widgets and credits. */
	def: FeatureDef;
	/** Shown only where this accepts the workspace's language (the language profile decides); absent: every language. */
	appliesTo?: (language: string) => boolean;
	/**
	 * The page, which routes `rest` itself (FeaturePage). Absent: the feature's pages are routes of their own whose
	 * layout guards them with FeatureGate (Stats: /stats, /stats/week, /stats/characters).
	 */
	component?: Component<{ rest: string }>;
}

function feature(
	id: string,
	title: MessageKey,
	def: FeatureDef,
	component?: Component<{ rest: string }>
): CoreFeature {
	return {
		id,
		get title() {
			return t(title);
		},
		slug: id,
		href: `/${id}`,
		def,
		component,
		appliesTo: APPLIES_TO[id]
	};
}

/** The features that appear only for some languages: the language profile says which (#204). */
const APPLIES_TO: Readonly<Record<string, (language: string) => boolean>> = {
	[SCRIPTS_ID]: (language) => writingSystemsOf(language).length > 0
};

/** The core features in the navigation order (docs/contracts/features/switches.json). */
export const coreFeatures: readonly CoreFeature[] = [
	feature(FLASHCARDS_ID, 'features.flashcards.title', flashcardsDef, FlashcardsPage),
	feature(READER_ID, 'features.reader.title', readerDef, ReaderPage),
	feature(JOURNAL_ID, 'features.journal.title', journalDef, JournalPage),
	feature(GRAMMAR_ID, 'features.grammar.title', grammarDef, GrammarPage),
	feature(SCRIPTS_ID, 'features.scripts.title', scriptsDef, ScriptsPage),
	feature(STATS_ID, 'features.stats.title', statsDef)
];

/**
 * The heading of a switched-off feature's page: one whole message per feature (a label and a verb glued
 * together cannot be translated; spec Ruling).
 */
const SWITCHED_OFF: Readonly<Record<string, MessageKey>> = {
	[FLASHCARDS_ID]: 'features.flashcards.switchedOff',
	[READER_ID]: 'features.reader.switchedOff',
	[JOURNAL_ID]: 'features.journal.switchedOff',
	[GRAMMAR_ID]: 'features.grammar.switchedOff',
	[SCRIPTS_ID]: 'features.scripts.switchedOff',
	[STATS_ID]: 'features.stats.switchedOff'
};

/** switchedOffTitle: "Flashcards are switched off" for a core feature id. */
export function switchedOffTitle(id: string): string {
	return t(SWITCHED_OFF[featureById(id).id]);
}

function stateOf(id: string, states: readonly FeatureSwitch[]): FeatureSwitch | undefined {
	return states.find((s) => s.id === id);
}

/** featureEnabled: the user's switch; a feature without a row is on. */
export function featureEnabled(id: string, states: readonly FeatureSwitch[]): boolean {
	return stateOf(id, states)?.enabled ?? true;
}

/** widgetFeatures: the features a widget needs on: its owner (unless core), then the ones it `requires`. */
export function widgetFeatures(widget: Pick<WidgetDef, 'owner' | 'requires'>): string[] {
	return [...(widget.owner === 'core' ? [] : [widget.owner]), ...(widget.requires ?? [])];
}

/**
 * widgetOffFeature: the first feature a widget needs that the server does not list as on (switched off, or no
 * row yet), or null when all are on.
 */
export function widgetOffFeature(widget: Pick<WidgetDef, 'owner' | 'requires'>, states: readonly FeatureSwitch[]): string | null {
	return widgetFeatures(widget).find((id) => stateOf(id, states)?.enabled !== true) ?? null;
}

/**
 * featureKnownOff: the switches are loaded and say the feature is off. A link into a feature's pages from
 * elsewhere hides then; while loading or after a failed load it stays, and the page says what it knows (#295).
 */
export function featureKnownOff(id: string, value: FeatureSwitchesValue): boolean {
	return value.status === 'ready' && !featureEnabled(id, value.list);
}

/**
 * featureWidgets: the widgets of the features the server lists as on (and
 * every feature a widget requires). A feature without a row (no switches
 * loaded yet) shows none, so a switched-off feature's widget never flashes in.
 */
export function featureWidgets(states: readonly FeatureSwitch[]): WidgetDef[] {
	return coreFeatures.flatMap((f) => f.def.widgets ?? []).filter((widget) => widgetOffFeature(widget, states) === null);
}

/** featureById: the core feature of an id. */
export function featureById(id: string): CoreFeature {
	const found = coreFeatures.find((f) => f.id === id);
	if (found === undefined) throw new Error(`not a core feature: ${id}`);
	return found;
}

/** findFeature resolves a feature by its slug; a switched-off one is undefined. */
export function findFeature(slug: string, states: readonly FeatureSwitch[]): CoreFeature | undefined {
	return coreFeatures.find((f) => f.slug === slug && featureEnabled(f.id, states));
}
