import { describe, expect, it } from 'vitest';

import { ineligibleKey, parseIneligible, withIneligible } from './ineligible';

describe('ineligible memory', () => {
	it('keys by kind and entry', () => {
		expect(ineligibleKey('sentence', 12)).toBe('sentence:12');
	});

	it('reads one workspace and tolerates junk', () => {
		const raw = JSON.stringify({ '1': ['sentence:1', 'tone:2', 7], '2': ['writing:3'] });
		expect([...parseIneligible(raw, 1)]).toEqual(['sentence:1', 'tone:2']);
		expect([...parseIneligible(raw, 3)]).toEqual([]);
		expect([...parseIneligible(null, 1)]).toEqual([]);
		expect([...parseIneligible('not json', 1)]).toEqual([]);
		expect([...parseIneligible('[1,2]', 1)]).toEqual([]);
	});

	it('adds a key to one workspace without touching the others', () => {
		const raw = JSON.stringify({ '2': ['writing:3'] });
		const next = withIneligible(raw, 1, 'sentence:1');
		expect([...parseIneligible(next, 1)]).toEqual(['sentence:1']);
		expect([...parseIneligible(next, 2)]).toEqual(['writing:3']);
		expect(withIneligible(next, 1, 'sentence:1')).toBe(next);
	});

	it('keeps at most the newest entries per workspace', () => {
		let raw: string | null = null;
		for (let i = 0; i < 5; i++) raw = withIneligible(raw, 1, `sentence:${i}`, 3);
		expect([...parseIneligible(raw, 1)]).toEqual(['sentence:2', 'sentence:3', 'sentence:4']);
	});
});
