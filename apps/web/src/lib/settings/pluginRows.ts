// What Settings -> Plugins says about one plugin: its permission lines
// and whether this app build cannot run it.

import type { PluginInfo } from '../api/types';
import type { WebPlugin } from '../plugins';
import { RESERVED_IDS } from '../features';
import { PERMISSION_LABELS, PERMISSIONS, sdkSupported, type Permission } from '../plugins/contract';

export interface PluginRowInfo {
	/** Permission labels joined with ` · `; empty for data plugins. */
	permissions: string;
	/**
	 * `app-update`: a feature plugin this build has no module for or whose sdk
	 * it does not run (the app is older than the plugin). `legacy`: a row
	 * registered without an sdk declaration (grandfathered).
	 */
	notice: 'app-update' | 'legacy' | null;
}

/**
 * listedPlugins: the rows Settings -> Plugins shows. The core row and the two
 * core features are never plugins (lib/features), whatever `hidden` says;
 * other rows the server flags hidden (surface-less built-ins) stay out too.
 */
export function listedPlugins<T extends PluginInfo>(list: readonly T[]): T[] {
	return list.filter((plugin) => !plugin.hidden && !RESERVED_IDS.has(plugin.id));
}

export function pluginRowInfo(plugin: PluginInfo, web: WebPlugin[]): PluginRowInfo {
	const manifest = plugin.manifest as { type?: unknown; permissions?: unknown };
	const declared = Array.isArray(manifest.permissions) ? manifest.permissions : [];
	const permissions = PERMISSIONS.filter((p) => declared.includes(p))
		.map((p: Permission) => PERMISSION_LABELS[p])
		.join(' · ');
	const feature = manifest.type === 'feature';
	const hasModule = web.some(
		(w) => w.manifest.id === plugin.id || `qinqin-${w.manifest.id}` === plugin.id
	);
	if (!feature) return { permissions, notice: null };
	const declaresSdk = typeof (plugin.manifest as { sdk?: unknown }).sdk === 'number';
	if (!declaresSdk) return { permissions, notice: 'legacy' };
	return { permissions, notice: !hasModule || !sdkSupported(plugin.manifest) ? 'app-update' : null };
}

/**
 * validOrder is true for an order the server accepts: a whole number of
 * 0 or more. A cleared number input reads as null/undefined/NaN, which the
 * server answers with a 400, so the row blocks saving instead.
 */
export function validOrder(order: unknown): order is number {
	return typeof order === 'number' && Number.isInteger(order) && order >= 0;
}
