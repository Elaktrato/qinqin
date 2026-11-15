// What Settings -> Plugins says about one plugin: its permission lines
// and whether this app build cannot run it.

import type { PluginInfo } from '../api/types';
import type { WebPlugin } from '../plugins';
import { PERMISSION_LABELS, PERMISSIONS, sdkSupported, type Permission } from '../plugins/contract';

export interface PluginRowInfo {
	/** Permission labels joined with ` · `; empty for data plugins. */
	permissions: string;
	/** A feature plugin this build has no module for, or whose sdk it does not run. */
	needsUpdate: boolean;
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
	return { permissions, needsUpdate: feature && (!hasModule || !sdkSupported(plugin.manifest)) };
}
