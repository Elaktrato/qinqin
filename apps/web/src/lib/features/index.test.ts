import { describe, expect, it } from 'vitest';
import type { PluginInfo } from '$lib/api/types';
import { webPlugins } from '$lib/plugins';
import { allWidgets } from '$lib/widgets/registry';
import { FLASHCARDS_ID, READER_ID, RESERVED_IDS, coreFeatures, featureEnabled, findFeature } from './index';

function state(id: string, order: number, enabled = true): PluginInfo {
	return { id, manifest: {}, enabled, order };
}

const ready = (list: PluginInfo[]) => ({ list, status: 'ready' as const });

describe('core features', () => {
	it('are Decks and Reader, with fixed ids, and are not web plugins', () => {
		expect(coreFeatures.map((f) => [f.id, f.title])).toEqual([
			[FLASHCARDS_ID, 'Decks'],
			[READER_ID, 'Reader']
		]);
		expect(FLASHCARDS_ID).toBe('qinqin-flashcards');
		expect(READER_ID).toBe('qinqin-reader');
		expect(coreFeatures.map((f) => f.href)).toEqual(['/flashcards', '/reader']);
		expect(webPlugins.map((p) => p.manifest.id)).toEqual(['qinqin-journal', 'qinqin-grammar']);
	});

	it('reserves the core, flashcards and reader registry ids', () => {
		expect([...RESERVED_IDS].sort()).toEqual(['qinqin-core', 'qinqin-flashcards', 'qinqin-reader']);
	});

	it('a feature without a state row is on; its row switches it', () => {
		expect(featureEnabled(READER_ID, [])).toBe(true);
		expect(featureEnabled(READER_ID, [state(READER_ID, 0, false)])).toBe(false);
		expect(featureEnabled(READER_ID, [state(FLASHCARDS_ID, 0, false)])).toBe(true);
	});

	it('findFeature resolves an enabled feature by its slug', () => {
		expect(findFeature('reader', [])?.id).toBe(READER_ID);
		expect(findFeature('flashcards', [state(FLASHCARDS_ID, 0, false)])).toBeUndefined();
		expect(findFeature('journal', [])).toBeUndefined();
	});
});

// navLinks moved into the frame's sections (lib/frame/sections.test.ts, #99).

describe('feature widgets', () => {
	it('exist while the feature is on, as in v0.3.0', () => {
		const ids = (states: PluginInfo[]) => allWidgets(webPlugins, states, 'zh').map((w) => w.id);
		const on = ids([state(FLASHCARDS_ID, 0), state(READER_ID, 0)]);
		expect(on).toEqual(expect.arrayContaining(['flashcards-summary', 'word-states', 'reading-time']));
		const off = ids([state(FLASHCARDS_ID, 0, false), state(READER_ID, 0)]);
		expect(off).not.toContain('flashcards-summary');
		expect(off).not.toContain('word-states');
		expect(off).toContain('reading-time');
		// No states yet: no feature widget can flash in.
		expect(ids([])).not.toContain('reading-time');
	});

	it('are owned by the feature id', () => {
		expect(coreFeatures.flatMap((f) => (f.manifest.widgets ?? []).map((w) => [w.id, w.owner]))).toEqual([
			['flashcards-summary', FLASHCARDS_ID],
			['word-states', FLASHCARDS_ID],
			['reading-time', READER_ID]
		]);
	});
});
