// Settings -> Features: one switch per core feature (lib/features,
// docs/contracts/features/). Switching off hides the feature for this user
// only and deletes nothing.

import { coreFeatures, featureEnabled } from '$lib/features';
import type { FeatureSwitch as StoredSwitch, FeatureSwitches } from '$lib/features/switches.svelte';

export interface FeatureSwitch {
	id: string;
	title: string;
	enabled: boolean;
}

/** featureSwitches: the switches as the user's rows say (no row = on). */
export function featureSwitches(states: readonly StoredSwitch[]): FeatureSwitch[] {
	return coreFeatures.map((f) => ({ id: f.id, title: f.title, enabled: featureEnabled(f.id, states) }));
}

/** saveFeatureSwitch stores one switch and refreshes the shared switches (nav, widgets, pages). */
export async function saveFeatureSwitch(features: Pick<FeatureSwitches, 'save'>, id: string, enabled: boolean): Promise<void> {
	await features.save(id, enabled);
}
