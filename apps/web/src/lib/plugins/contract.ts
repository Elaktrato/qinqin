// The feature-plugin contract (sdk 1), single-sourced: the built-in
// manifests are the JSON files under server/internal/plugins/builtin/,
// which the Go server embeds and validates (plugins.ParseManifest) and
// this build imports through the `$builtin` alias.

import core from '$builtin/core.json';
import flashcards from '$builtin/flashcards.json';
import journal from '$builtin/journal.json';
import reader from '$builtin/reader.json';

/** The contract version this build runs (the server's SDKMin = SDKMax). */
export const SDK_VERSION = 1;

export const SURFACES = ['home-widget', 'page', 'hook'] as const;
export const PERMISSIONS = [
	'owns-data',
	'read:entries',
	'read:study-events',
	'write:study-events'
] as const;
export const HOOKS = ['study-event'] as const;

export type Surface = (typeof SURFACES)[number];
export type Permission = (typeof PERMISSIONS)[number];
export type Hook = (typeof HOOKS)[number];

/** How an event type counts as heatmap activity (mirrors plugins.ActivityRule). */
export interface ActivityRule {
	label: string;
	describe: { one: string; other: string };
	measure?: { field: string; unit: 'seconds'; min: number; max: number };
	pointsPer?: number;
	distinctBy?: string;
}

/** One event type a plugin emits; `activity` is the optional counting rule. */
export interface EventDecl {
	type: string;
	activity?: ActivityRule;
}

/** ContractManifest mirrors the manifest JSON the server stores and serves. */
export interface ContractManifest {
	id: string;
	name: string;
	version: string;
	type: 'feature';
	sdk: number;
	description?: string;
	surfaces: Surface[];
	permissions: Permission[];
	hooks: Hook[];
	events: EventDecl[];
}

/** What each permission means, in plain words, for Settings. */
export const PERMISSION_LABELS: Record<Permission, string> = {
	'owns-data': 'Stores its own data',
	'read:entries': 'Reads dictionary entries',
	'read:study-events': 'Reads your study history',
	'write:study-events': 'Records study activity'
};

/** sdkSupported is true for a manifest object whose integer sdk this build runs. */
export function sdkSupported(manifest: unknown): boolean {
	if (typeof manifest !== 'object' || manifest === null) return false;
	return (manifest as { sdk?: unknown }).sdk === SDK_VERSION;
}

const BUILTINS = [core, flashcards, reader, journal] as unknown as ContractManifest[];

/** builtinManifests lists core, flashcards, reader, journal, in the server's order. */
export function builtinManifests(): ContractManifest[] {
	return BUILTINS;
}

const CORE_ID = 'qinqin-core';

/**
 * logChangingTypes is every event type declared by a built-in other than
 * the core: only those change what the readers of the full event log
 * show. The core's `session` event is posted on every home load, and
 * dropping the cached log for it would defeat the cache.
 */
export function logChangingTypes(): ReadonlySet<string> {
	return new Set(
		BUILTINS.filter((m) => m.id !== CORE_ID).flatMap((m) => m.events.map((e) => e.type))
	);
}
