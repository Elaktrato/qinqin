// A widget is one self-contained view of the user's learning (the
// activity heatmap, the flashcards summary, …). The core app declares
// its own in ./core.ts; a core feature declares its widgets in its
// definition (`FeatureDef.widgets`, lib/features). Stats shows every available widget; the
// home page shows the ones in the user's layout (./layout.ts).

import type { Component } from 'svelte';

export type WidgetSurface = 'stats' | 'home';

export interface WidgetDef {
	/** Stable id, stored in the user's home layout, e.g. 'activity-heatmap'. */
	id: string;
	/** Shown in Stats and Settings. */
	title: string;
	/** One line, shown in the Settings picker. */
	description: string;
	/** 'core' for the app's own widgets, else the owning feature id (e.g. 'flashcards'). */
	owner: 'core' | string;
	/** Other features that must be on too (word states: flashcards' and needs Stats, #295); omitted = none. */
	requires?: readonly string[];
	/** 'wide' spans the whole row of the widget grid. */
	size: 'normal' | 'wide';
	/** Show only for these languages; omitted = every language. */
	appliesTo?: (language: string) => boolean;
	/** Where it can render. 'home' marks it selectable for the home page. */
	surfaces: WidgetSurface[];
	/** Takes no props: it reads the workspace store itself and handles its own states. */
	component: Component;
	/** Compact variant for the home page, when the Stats version is large. */
	homeComponent?: Component;
}

/** The states a widget passes through; WidgetCard renders all but `ready`. */
export type WidgetStatus = 'no-workspace' | 'loading' | 'error' | 'empty' | 'ready';
