// The core app's own manifest: no surfaces, no pages. It exists so the
// plugin data routes and sync accept the core's per-user rows (the home
// layout) and so the event types session, view and lookup have an owner.
import core from '$builtin/core.json';
import type { ContractManifest } from '../contract';
import type { PluginManifest } from '../index';

export const coreManifest: PluginManifest = { ...(core as unknown as ContractManifest) };

/**
 * CORE_PLUGIN_ID is the core app registered as a plugin with no
 * surfaces. It is not a feature the user can switch off.
 */
export const CORE_PLUGIN_ID = coreManifest.id;
