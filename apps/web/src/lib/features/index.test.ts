import { describe, expect, it } from 'vitest';
import { allWidgets } from '$lib/widgets/registry';
import type { FeatureSwitch } from './switches.svelte';
import { FLASHCARDS_ID, GRAMMAR_ID, JOURNAL_ID, READER_ID, STATS_ID, coreFeatures, featureById, featureEnabled, featureKnownOff, findFeature, widgetFeatures, widgetOffFeature } from './index';

function state(id: string, enabled = true): FeatureSwitch {
	return { id, enabled };
}

const ALL_ON = [state(FLASHCARDS_ID), state(READER_ID), state(JOURNAL_ID), state(GRAMMAR_ID), state(STATS_ID)];

describe('core features', () => {
	it('are the seven core features, with fixed ids and routes', () => {
		expect(coreFeatures.map((f) => [f.id, f.title])).toEqual([
			['flashcards', 'Decks'],
			['reader', 'Reader'],
			['journal', 'Journal'],
			['grammar', 'Grammar'],
			['scripts', 'Scripts'],
			['practice', 'Practice'],
			['stats', 'Stats']
		]);
		expect(coreFeatures.map((f) => f.href)).toEqual(['/flashcards', '/reader', '/journal', '/grammar', '/scripts', '/practice', '/stats']);
	});

	it('a feature without a switch row is on; its row switches it', () => {
		expect(featureEnabled(READER_ID, [])).toBe(true);
		expect(featureEnabled(READER_ID, [state(READER_ID, false)])).toBe(false);
		expect(featureEnabled(READER_ID, [state(FLASHCARDS_ID, false)])).toBe(true);
	});

	it('featureKnownOff: only loaded switches that say off; loading, failed or no row is not known off (links stay)', () => {
		expect(featureKnownOff(STATS_ID, { list: [state(STATS_ID, false)], status: 'ready' })).toBe(true);
		expect(featureKnownOff(STATS_ID, { list: [state(STATS_ID)], status: 'ready' })).toBe(false);
		expect(featureKnownOff(STATS_ID, { list: [], status: 'ready' })).toBe(false);
		for (const status of ['idle', 'loading', 'error'] as const) expect(featureKnownOff(STATS_ID, { list: [], status })).toBe(false);
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

	it('a widget that requires another feature needs it on too (word states: flashcards and Stats, #295)', () => {
		const wordStates = coreFeatures.flatMap((f) => f.def.widgets ?? []).find((w) => w.id === 'word-states')!;
		expect(wordStates.requires).toEqual([STATS_ID]);
		expect(widgetFeatures(wordStates)).toEqual([FLASHCARDS_ID, STATS_ID]);
		expect(widgetOffFeature(wordStates, [state(FLASHCARDS_ID), state(STATS_ID, false)])).toBe(STATS_ID);
		expect(widgetOffFeature(wordStates, [state(FLASHCARDS_ID, false), state(STATS_ID, false)])).toBe(FLASHCARDS_ID);
		expect(widgetOffFeature(wordStates, [state(FLASHCARDS_ID), state(STATS_ID)])).toBeNull();
	});

	it('are owned by the feature id', () => {
		expect(coreFeatures.flatMap((f) => (f.def.widgets ?? []).map((w) => [w.id, w.owner]))).toEqual([
			['flashcards-summary', FLASHCARDS_ID],
			['word-states', FLASHCARDS_ID],
			['reading-time', READER_ID],
			['scripts-progress', 'scripts'],
			['activity-heatmap', STATS_ID],
			['character-map-summary', STATS_ID],
			['summary-numbers', STATS_ID],
			['reviews-per-day', STATS_ID]
		]);
	});
});
