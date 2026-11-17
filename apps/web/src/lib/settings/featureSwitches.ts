// Settings -> Features: one switch per core feature (lib/features). The
// switch is the user's state row of the reserved registry id; `order` means
// nothing for these ids, so it is always sent as 0. Switching off hides the
// feature for this user only and deletes nothing.

import { api } from '$lib/api/client';
import type { PluginInfo } from '$lib/api/types';
import { coreFeatures, featureEnabled } from '$lib/features';
import { loadPluginStates } from '$lib/plugins/states';

export interface FeatureSwitch {
	id: string;
	title: string;
	enabled: boolean;
}

/** featureSwitches: the switches as the user's states say (no row = on). */
export function featureSwitches(states: readonly PluginInfo[]): FeatureSwitch[] {
	return coreFeatures.map((f) => ({ id: f.id, title: f.title, enabled: featureEnabled(f.id, states) }));
}

/** saveFeatureSwitch stores one switch and refreshes the shared states (nav, widgets, pages). */
export async function saveFeatureSwitch(id: string, enabled: boolean): Promise<void> {
	await api(`/api/plugins/${encodeURIComponent(id)}/state`, { method: 'PUT', body: { enabled, order: 0 } });
	await loadPluginStates();
}
