import { describe, expect, it } from 'vitest';

import {
	DECKCFG_PREFIX,
	enabledKinds,
	parseDeckSettings,
	serializeDeckSettings,
	type DeckSettings
} from './deckSettings';
import deckcfgFixture from '../../../../../docs/contracts/frequency/deckcfg-new-order.json';

describe('parseDeckSettings', () => {
	it('round-trips and keeps unknown fields', () => {
		const raw = {
			deckId: 'd1',
			cardTypes: ['cloze', 'reverse', 'bogus', 'vocab'],
			updatedAt: '2026-01-01T00:00:00Z',
			limits: { new: 5 }
		};
		const parsed = parseDeckSettings('deckcfg:d1', raw)!;
		expect(parsed.cardTypes).toEqual(['reverse', 'cloze']);
		expect(parsed.extra).toEqual({ limits: { new: 5 } });
		expect(serializeDeckSettings(parsed, '2026-02-02T00:00:00Z')).toEqual({
			limits: { new: 5 },
			deckId: 'd1',
			cardTypes: ['reverse', 'cloze'],
			updatedAt: '2026-02-02T00:00:00Z'
		});
	});

	it('rejects a key that does not match the deck id, and non-objects', () => {
		expect(parseDeckSettings('deckcfg:d2', { deckId: 'd1', cardTypes: [] })).toBeNull();
		expect(parseDeckSettings('deckcfg:d1', 'x')).toBeNull();
		expect(parseDeckSettings('deck:d1', { deckId: 'd1', cardTypes: [] })).toBeNull();
	});

	it('accepts the general deck and treats missing cardTypes as none', () => {
		expect(parseDeckSettings('deckcfg:general', { deckId: 'general' })?.cardTypes).toEqual([]);
		expect(DECKCFG_PREFIX).toBe('deckcfg:');
	});
});

describe('enabledKinds', () => {
	const settings: Record<string, DeckSettings> = {
		a: { deckId: 'a', cardTypes: ['reverse'], extra: {} },
		b: { deckId: 'b', cardTypes: ['cloze'], extra: {} }
	};
	it('unions over the given decks only', () => {
		expect([...enabledKinds(settings, ['a'])]).toEqual(['reverse']);
		expect([...enabledKinds(settings, ['a', 'b', 'zz'])].sort()).toEqual(['cloze', 'reverse']);
		expect(enabledKinds(undefined, ['a']).size).toBe(0);
	});
});

describe('newOrder field (frequency/deckcfg-new-order.json)', () => {
	it.each(deckcfgFixture.cases)('$name', (c) => {
		const parsed = parseDeckSettings('deckcfg:d1', c.row)!;
		expect(parsed.newOrder ?? null).toEqual(c.newOrder);
		expect(parsed.extra).toEqual(c.extra);
	});

	it('serialize writes newOrder only when set', () => {
		const base: DeckSettings = { deckId: 'd1', cardTypes: ['reverse'], extra: { goal: 1 } };
		expect(serializeDeckSettings(base, 't')).toEqual({
			goal: 1,
			deckId: 'd1',
			cardTypes: ['reverse'],
			updatedAt: 't'
		});
		expect(serializeDeckSettings({ ...base, newOrder: null }, 't')).not.toHaveProperty('newOrder');
		expect(
			serializeDeckSettings({ ...base, newOrder: { by: 'level', packId: 'hsk-words' } }, 't')
		).toEqual({
			goal: 1,
			deckId: 'd1',
			cardTypes: ['reverse'],
			newOrder: { by: 'level', packId: 'hsk-words' },
			updatedAt: 't'
		});
	});

	it('a malformed newOrder is dropped, not kept in extra', () => {
		const parsed = parseDeckSettings('deckcfg:d1', {
			deckId: 'd1',
			cardTypes: ['cloze'],
			newOrder: { by: 'level' }
		})!;
		expect(parsed.newOrder ?? null).toBeNull();
		expect(parsed.extra).toEqual({});
		expect(parsed.cardTypes).toEqual(['cloze']);
		expect(serializeDeckSettings(parsed, 't')).not.toHaveProperty('newOrder');
	});
});
