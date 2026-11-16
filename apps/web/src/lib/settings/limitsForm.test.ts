import { describe, expect, it } from 'vitest';
import { deckFieldFrom, deckRowFrom, workspaceFieldFrom, workspaceRowFrom, workspaceChoiceLabel } from './limitsForm';

describe('deck fields', () => {
	it('reads a missing field as "use workspace", a number as a value and null as unlimited', () => {
		expect(deckFieldFrom({ new: 5 }, 'new')).toEqual({ mode: 'value', value: '5' });
		expect(deckFieldFrom({ new: 5 }, 'reviews')).toEqual({ mode: 'workspace', value: '' });
		expect(deckFieldFrom({ reviews: null }, 'reviews')).toEqual({ mode: 'unlimited', value: '' });
		expect(deckFieldFrom(null, 'new')).toEqual({ mode: 'workspace', value: '' });
	});

	it('writes only what differs from the workspace: an unlimited reviews field and no new field', () => {
		expect(
			deckRowFrom({ mode: 'workspace', value: '' }, { mode: 'unlimited', value: '' })
		).toEqual({ row: { reviews: null } });
	});

	it('writes own values, zero included', () => {
		expect(deckRowFrom({ mode: 'value', value: '0' }, { mode: 'value', value: '15' })).toEqual({ row: { new: 0, reviews: 15 } });
	});

	it('an all-workspace row is empty (the row is removed)', () => {
		expect(deckRowFrom({ mode: 'workspace', value: '' }, { mode: 'workspace', value: '' })).toEqual({ row: {} });
	});

	it('refuses a fraction, a negative, a too large and an empty value', () => {
		for (const value of ['2.5', '-1', '10000', '', 'abc']) {
			expect(deckRowFrom({ mode: 'value', value }, { mode: 'workspace', value: '' })).toEqual({
				error: 'Enter a whole number from 0 to 9999.'
			});
		}
	});
});

describe('workspace fields', () => {
	it('shows the default when there is no row', () => {
		expect(workspaceFieldFrom(null, 'new')).toEqual({ mode: 'value', value: '20' });
		expect(workspaceFieldFrom(null, 'reviews')).toEqual({ mode: 'value', value: '200' });
		expect(workspaceFieldFrom({ new: null }, 'new')).toEqual({ mode: 'unlimited', value: '' });
	});
	it('writes both fields', () => {
		expect(workspaceRowFrom({ mode: 'value', value: '10' }, { mode: 'unlimited', value: '' })).toEqual({ row: { new: 10, reviews: null } });
	});
});

describe('workspaceChoiceLabel', () => {
	it('names the workspace value', () => {
		expect(workspaceChoiceLabel(20)).toBe('Use workspace limit (20)');
		expect(workspaceChoiceLabel(null)).toBe('Use workspace limit (unlimited)');
	});
});
