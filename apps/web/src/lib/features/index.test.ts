import { describe, expect, it } from 'vitest';
import { allWidgets } from '$lib/widgets/registry';
import type { FeatureSwitch } from './switches.svelte';
import { FLASHCARDS_ID, GRAMMAR_ID, JOURNAL_ID, READER_ID, STATS_ID, coreFeatures, featureById, featureEnabled, findFeature } from './index';

function state(id: string, enabled = true): FeatureSwitch {
	return { id, enabled };
}

const ALL_ON = [state(FLASHCARDS_ID), state(READER_ID), state(JOURNAL_ID), state(GRAMMAR_ID)];

describe('core features', () => {
	it('are the six core features, with fixed ids and routes', () => {
		expect(coreFeatures.map((f) => [f.id, f.title])).toEqual([
			['flashcards', 'Decks'],
			['reader', 'Reader'],
			['journal', 'Journal'],
			['grammar', 'Grammar'],
			['scripts', 'Scripts'],
			['stats', 'Stats']
		]);
		expect(coreFeatures.map((f) => f.href)).toEqual(['/flashcards', '/reader', '/journal', '/grammar', '/scripts', '/stats']);
	});

	it('a feature without a switch row is on; its row switches it', () => {
		expect(featureEnabled(READER_ID, [])).toBe(true);
		expect(featureEnabled(READER_ID, [state(READER_ID, false)])).toBe(false);
		expect(featureEnabled(READER_ID, [state(FLASHCARDS_ID, false)])).toBe(true);
	});

	it('findFeature resolves an enabled feature by its slug', () => {
		expect(findFeature('reader', [])?.id).toBe(READER_ID);
		expect(findFeature('journal', [])?.id).toBe(JOURNAL_ID);
		expect(findFeature('flashcards', [state(FLASHCARDS_ID, false)])).toBeUndefined();
		expect(findFeature('notes', [])).toBeUndefined();
		expect(findFeature('stats', [state(STATS_ID, false)])).toBeUndefined();
	});

	it('Stats has no page component: its routes guard themselves (FeatureGate in routes/stats/+layout.svelte)', () => {
		expect(featureById(STATS_ID).component).toBeUndefined();
		expect(featureById(FLASHCARDS_ID).component).toBeDefined();
	});

	it('featureById refuses an id that is no core feature', () => {
		expect(featureById(GRAMMAR_ID).slug).toBe('grammar');
		expect(featureById(STATS_ID).slug).toBe('stats');
		expect(() => featureById('qinqin-journal')).toThrow();
	});
});

// navLinks moved into the frame's sections (lib/frame/sections.test.ts, #99).

describe('feature widgets', () => {
	it('exist while the feature is on', () => {
		const ids = (states: FeatureSwitch[]) => allWidgets(states, 'zh').map((w) => w.id);
		const on = ids(ALL_ON);
		expect(on).toEqual(expect.arrayContaining(['flashcards-summary', 'word-states', 'reading-time']));
		const off = ids([state(FLASHCARDS_ID, false), state(READER_ID)]);
		expect(off).not.toContain('flashcards-summary');
		expect(off).not.toContain('word-states');
		expect(off).toContain('reading-time');
		// No switches yet: no feature widget can flash in.
		expect(ids([])).not.toContain('reading-time');
	});

	it('are owned by the feature id', () => {
		expect(coreFeatures.flatMap((f) => (f.def.widgets ?? []).map((w) => [w.id, w.owner]))).toEqual([
			['flashcards-summary', FLASHCARDS_ID],
			['word-states', FLASHCARDS_ID],
			['reading-time', READER_ID],
			['scripts-progress', 'scripts']
		]);
	});
});
