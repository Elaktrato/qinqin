import { describe, expect, it } from 'vitest';
import type { EventType } from '$lib/events';
import { builtinManifests } from './contract';
import { webPlugins } from './index';

// Every EventType literal of lib/events.ts: the compiler rejects a
// literal that is not an EventType, and the exhaustive check below makes
// a missing one fail the build.
const EVENT_TYPES = ['session', 'view', 'lookup', 'review', 'read', 'journal'] as const satisfies readonly EventType[];
type Missing = Exclude<EventType, (typeof EVENT_TYPES)[number]>;
const noneMissing: Missing extends never ? true : false = true;

describe('web plugin manifests', () => {
	// Flashcards and the reader are core features since v0.4.0: their
	// registry rows declare no surface (server/internal/plugins/builtin), and
	// phase B of the core-features plan takes them out of webPlugins.
	const coreFeatures = new Set(['qinqin-flashcards', 'qinqin-reader']);
	for (const plugin of webPlugins) {
		it(`${plugin.manifest.id}: surfaces match what it ships`, () => {
			const { surfaces, widgets } = plugin.manifest;
			if (coreFeatures.has(plugin.manifest.id)) {
				expect(surfaces).toEqual([]);
				return;
			}
			expect(surfaces.includes('page')).toBe(Boolean(plugin.pages?.length));
			expect(surfaces.includes('home-widget')).toBe(Boolean(widgets?.length));
		});

		it(`${plugin.manifest.id}: identity equals the server's JSON`, () => {
			const json = builtinManifests().find((m) => m.id === plugin.manifest.id);
			expect(json).toBeDefined();
			expect(plugin.manifest.name).toBe(json!.name);
			expect(plugin.manifest.version).toBe(json!.version);
			expect(plugin.manifest.surfaces).toEqual(json!.surfaces);
		});
	}

	it('every EventType is declared by exactly one built-in', () => {
		expect(noneMissing).toBe(true);
		for (const type of EVENT_TYPES) {
			const owners = builtinManifests().filter((m) => m.events.some((e) => e.type === type));
			expect(owners.length, type).toBe(1);
		}
	});
});
