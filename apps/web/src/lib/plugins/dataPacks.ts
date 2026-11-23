import type { PackType } from '$lib/api/packs';
import type { PluginInfo } from '$lib/api/types';

/**
 * Every data pack type (docs/contracts/packages/pack-types.json; a test
 * keeps the two equal).
 */
export const PACK_TYPES: readonly PackType[] = [
	'dictionary',
	'frequency',
	'levels',
	'sentences',
	'grammar',
	'audio',
	'components',
	'strokes',
	'lemma-rules',
	'theme',
	'font'
];

/**
 * isDataPackPlugin is true for the registry rows the server synthesizes
 * for installed data packs (v0.3.x compatibility; the server marks them
 * hidden too). Their Enabled toggles do nothing; packs are managed in
 * Settings → Data, so the Plugins tab lists feature plugins only.
 */
export function isDataPackPlugin(plugin: PluginInfo): boolean {
	const type = plugin.manifest.type;
	return typeof type === 'string' && (PACK_TYPES as readonly string[]).includes(type);
}
