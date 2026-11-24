// The widget registry: the widgets the current user can see right now: the
// core app's and those of the core features that are on (lib/features).

import { featureWidgets } from '$lib/features';
import type { FeatureSwitch } from '$lib/features/switches.svelte';
import { coreWidgets } from './core';
import type { WidgetDef } from './types';

/**
 * allWidgets lists the available widgets: core widgets first, then those of
 * the core features that are on. With no switches loaded only core widgets
 * remain. With a language set, a widget's `appliesTo` must accept it; a null
 * language (no workspace) applies no filter. A duplicated id keeps its first
 * widget.
 */
export function allWidgets(states: readonly FeatureSwitch[], language: string | null, core: WidgetDef[] = coreWidgets): WidgetDef[] {
	const seen = new Set<string>();
	return [...core, ...featureWidgets(states)].filter((widget) => {
		if (seen.has(widget.id)) return false;
		seen.add(widget.id);
		return language === null || !widget.appliesTo || widget.appliesTo(language);
	});
}
