import { describe, expect, it } from 'vitest';
import { defaultSetup, type StudySetup } from './setup';
import type { OptInKind } from '$lib/studycore/types';
import { chipPatch, noteText, summaryLine, todayLine, toggleChip, visibleChips } from './studyModalView';

const none = new Set<OptInKind>();
const reverseOn = new Set<OptInKind>(['reverse']);

describe('visibleChips', () => {
	it('shows only the kinds the language offers', () => {
		expect(visibleChips(defaultSetup(), none, 'es').map((c) => c.id)).toEqual(['vocab', 'sentence']);
		expect(visibleChips(defaultSetup(), none, 'zh').map((c) => c.id)).toEqual(['vocab', 'sentence', 'writing', 'tone']);
	});
	it('shows Reverse and Cloze only when a selected deck switches them on, checked unless unchecked', () => {
		const chips = visibleChips(defaultSetup(), reverseOn, 'ja');
		expect(chips.map((c) => c.id)).toEqual(['vocab', 'sentence', 'writing', 'reverse']);
		expect(chips.find((c) => c.id === 'reverse')?.checked).toBe(true);
		const off = visibleChips({ ...defaultSetup(), unchecked: ['reverse'] }, reverseOn, 'ja');
		expect(off.find((c) => c.id === 'reverse')?.checked).toBe(false);
	});
	it('a level session never shows Reverse or Cloze', () => {
		const chips = visibleChips({ ...defaultSetup(), mode: 'levels' }, reverseOn, 'ja');
		expect(chips.map((c) => c.id)).not.toContain('reverse');
	});
	it('locks the last selected chip, an opt-in one included', () => {
		expect(visibleChips(defaultSetup(), none, 'ja').find((c) => c.id === 'vocab')?.locked).toBe(true);
		expect(visibleChips(defaultSetup(), reverseOn, 'ja').find((c) => c.id === 'vocab')?.locked).toBe(false);
		const onlyReverse: StudySetup = { ...defaultSetup(), cardTypes: [] };
		expect(visibleChips(onlyReverse, reverseOn, 'ja').find((c) => c.id === 'reverse')?.locked).toBe(true);
	});
});

describe('toggleChip', () => {
	it('toggles a kind in the setup', () => {
		expect(toggleChip(defaultSetup(), 'writing', none, 'ja').cardTypes).toEqual(['vocab', 'writing']);
		expect(toggleChip({ ...defaultSetup(), cardTypes: ['vocab', 'writing'] }, 'vocab', none, 'ja').cardTypes).toEqual(['writing']);
	});
	it('an opt-in chip only changes unchecked', () => {
		const off = toggleChip(defaultSetup(), 'reverse', reverseOn, 'ja');
		expect(off.unchecked).toEqual(['reverse']);
		expect(off.cardTypes).toEqual(['vocab']);
		expect(toggleChip(off, 'reverse', reverseOn, 'ja').unchecked).toEqual([]);
	});
	it('never leaves nothing selected', () => {
		expect(toggleChip(defaultSetup(), 'vocab', none, 'ja')).toEqual(defaultSetup());
	});
});

describe('the lines', () => {
	it('words the summary of decks and of a level', () => {
		expect(summaryLine({ mode: 'decks', due: 12, fresh: 8, decks: 4, scheme: null, level: null })).toBe('12 due · 8 new · 4 decks');
		expect(summaryLine({ mode: 'decks', due: 0, fresh: 1, decks: 1, scheme: null, level: null })).toBe('0 due · 1 new · 1 deck');
		expect(summaryLine({ mode: 'levels', due: 12, fresh: 8, decks: 4, scheme: 'HSK', level: '2' })).toBe('HSK 2 · 12 due · 8 new');
	});
	it('words this session, or why nothing can start', () => {
		expect(todayLine(20, '')).toBe('This session: 20 cards');
		expect(todayLine(1, '')).toBe('This session: 1 card');
		expect(todayLine(0, 'Nothing is due.')).toBe('Nothing is due.');
	});
	it('says what a repair changed', () => {
		expect(noteText(['levelGone'])).toBe('Your level is no longer installed; studying your decks instead.');
		expect(noteText([])).toBeNull();
	});
});

describe('chipPatch', () => {
	it('is only the member a click changes', () => {
		expect(chipPatch(defaultSetup(), 'writing', none, 'ja')).toEqual({ cardTypes: ['vocab', 'writing'] });
		expect(chipPatch(defaultSetup(), 'reverse', reverseOn, 'ja')).toEqual({ unchecked: ['reverse'] });
		expect(chipPatch(defaultSetup(), 'vocab', none, 'ja')).toEqual({});
	});
});
