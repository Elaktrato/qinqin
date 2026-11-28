import { describe, expect, it } from 'vitest';
import { companionNote, sessionStartError, showCompanionNote } from './sessionStart';

describe('sessionStartError', () => {
	it('online: the original message', () => {
		expect(sessionStartError({ offline: false, mode: 'decks', fallback: 'Could not start your session.' })).toBe(
			'Could not start your session.'
		);
	});

	it('offline deck session without saved data: not ready for offline study', () => {
		expect(sessionStartError({ offline: true, mode: 'decks', fallback: 'x' })).toBe(
			"This workspace isn't ready for offline study yet. Open it once while online."
		);
	});

	it('offline level session: needs a connection', () => {
		expect(sessionStartError({ offline: true, mode: 'levels', fallback: 'x' })).toBe(
			'Level sessions need a connection. Start a deck session instead.'
		);
	});
});

describe('showCompanionNote', () => {
	it('only offline and only when companion kinds were asked for', () => {
		expect(showCompanionNote({ offline: true, kinds: ['vocab'] })).toBe(false);
		expect(showCompanionNote({ offline: true, kinds: ['vocab', 'sentence'] })).toBe(true);
		expect(showCompanionNote({ offline: false, kinds: ['vocab', 'sentence'] })).toBe(false);
		expect(companionNote()).toBe('Companion cards return when you are online.');
	});
});
