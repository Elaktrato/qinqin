// Test fixtures: a PluginManifest that satisfies the whole contract, so
// a test states only the fields it cares about.
import type { PluginManifest } from './index';

export function fixtureManifest(
	fields: Partial<PluginManifest> & Pick<PluginManifest, 'id' | 'name'>
): PluginManifest {
	return {
		version: '1.0',
		type: 'feature',
		sdk: 1,
		surfaces: [],
		permissions: [],
		hooks: [],
		events: [],
		...fields
	};
}
