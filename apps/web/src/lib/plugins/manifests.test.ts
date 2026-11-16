import { describe, expect, it } from 'vitest';
import type { EventType } from '$lib/events';
import { builtinManifests } from './contract';
import { webPlugins } from './index';
import { coreFeatures } from '$lib/features';

// Every EventType literal of lib/events.ts: the compiler rejects a
// literal that is not an EventType, and the exhaustive check below makes
// a missing one fail the build.
const EVENT_TYPES = ['session', 'view', 'lookup', 'review', 'read', 'journal'] as const satisfies readonly EventType[];
type Missing = Exclude<EventType, (typeof EVENT_TYPES)[number]>;
const noneMissing: Missing extends never ? true : false = true;

describe('web plugin manifests', () => {
	for (const plugin of webPlugins) {
		it(`${plugin.manifest.id}: surfaces match what it ships`, () => {
			const { surfaces, widgets } = plugin.manifest;
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

	// Flashcards and the reader are core features since v0.4.0: their
	// registry rows are reserved, declare no surface and no event.
	for (const feature of coreFeatures) {
		it(`${feature.id}: a reserved core row without surfaces or events`, () => {
			const json = builtinManifests().find((m) => m.id === feature.id);
			expect(json?.surfaces).toEqual([]);
			expect(json?.events).toEqual([]);
			expect(webPlugins.some((p) => p.manifest.id === feature.id)).toBe(false);
		});
	}

	it('every EventType is declared once, by core, journal or grammar', () => {
		const owners = new Map<string, string[]>();
		for (const m of builtinManifests()) for (const e of m.events) owners.set(e.type, [...(owners.get(e.type) ?? []), m.id]);
		expect(Object.fromEntries(owners)).toEqual({
			session: ['qinqin-core'],
			view: ['qinqin-core'],
			lookup: ['qinqin-core'],
			review: ['qinqin-core'],
			read: ['qinqin-core'],
			journal: ['qinqin-journal']
		});
	});

	it('every EventType is declared by exactly one built-in', () => {
		expect(noneMissing).toBe(true);
		for (const type of EVENT_TYPES) {
			const owners = builtinManifests().filter((m) => m.events.some((e) => e.type === type));
			expect(owners.length, type).toBe(1);
		}
	});
});
