import type { PluginInfo } from '$lib/api/types';

const PACK_TYPES = ['dictionary', 'frequency', 'levels', 'sentences', 'grammar'];

/**
 * isDataPackPlugin is true for the registry rows the server synthesizes
 * for installed data packs. Their Enabled toggles do nothing; packs are
 * managed in Settings → Data, so the Plugins tab lists feature plugins only.
 */
export function isDataPackPlugin(plugin: PluginInfo): boolean {
	const type = plugin.manifest.type;
	return typeof type === 'string' && PACK_TYPES.includes(type);
}
