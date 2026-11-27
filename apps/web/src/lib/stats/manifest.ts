// Stats as a core feature (#295, lib/features): its widgets. The pages are the routes /stats, /stats/week and
// /stats/characters, which FeatureGate guards in routes/stats/+layout.svelte.
import type { FeatureDef } from '$lib/features';

export const statsDef: FeatureDef = {
	widgets: []
};
