import { describe, expect, it } from 'vitest';
import type { Workspace } from './api/types';
import { hiddenDictionaries, hiddenFor, partitionSenses } from './dictionaryVisibility';

function ws(id: number, settings: Record<string, unknown> = {}): Workspace {
	return { id, language: 'zh', name: '', settings, updatedAt: 't' };
}

describe('hiddenDictionaries', () => {
	it('keeps positive integers and ignores malformed values', () => {
		expect(hiddenDictionaries(ws(1, { hiddenDictionaries: [3, 'x', 4.5, -1, 7] }))).toEqual(
			new Set([3, 7])
		);
	});

	it('is empty when missing, not an array, or no workspace', () => {
		expect(hiddenDictionaries(ws(1)).size).toBe(0);
		expect(hiddenDictionaries(ws(1, { hiddenDictionaries: 'x' })).size).toBe(0);
		expect(hiddenDictionaries(null).size).toBe(0);
		expect(hiddenDictionaries(undefined).size).toBe(0);
	});
});

describe('hiddenFor', () => {
	const a = ws(1, { hiddenDictionaries: [1] });
	const b = ws(2, { hiddenDictionaries: [2] });
	it("uses the book's workspace when found, else the current one", () => {
		expect(hiddenFor([a, b], 2, a)).toEqual(new Set([2]));
		expect(hiddenFor([a, b], 99, a)).toEqual(new Set([1]));
		expect(hiddenFor([a, b], null, b)).toEqual(new Set([2]));
		expect(hiddenFor([], null, null).size).toBe(0);
	});
});

describe('partitionSenses', () => {
	const senses = [
		{ dictionaryId: 1, g: 'a' },
		{ dictionaryId: 2, g: 'b' },
		{ dictionaryId: 1, g: 'c' }
	];
	it('splits keeping order', () => {
		const p = partitionSenses(senses, new Set([2]));
		expect(p.shown.map((s) => s.g)).toEqual(['a', 'c']);
		expect(p.hidden.map((s) => s.g)).toEqual(['b']);
		expect(p.allHidden).toBe(false);
	});
	it('shows everything when all would be hidden', () => {
		const p = partitionSenses(senses, new Set([1, 2]));
		expect(p.shown).toHaveLength(3);
		expect(p.hidden).toHaveLength(0);
		expect(p.allHidden).toBe(true);
	});
	it('shows everything for an empty set or empty senses', () => {
		expect(partitionSenses(senses, new Set()).shown).toHaveLength(3);
		expect(partitionSenses([], new Set([1])).allHidden).toBe(false);
	});
});
