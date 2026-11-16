import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/frequency/display-form.json';
import { displayForm, type DisplayEntry } from './displayForm';

describe('displayForm (frequency/display-form.json)', () => {
	it('is the display form rule', () => {
		expect(fixture.rule).toBe('frequency/display-form');
		expect(fixture.cases.length).toBeGreaterThanOrEqual(20);
	});

	it.each(fixture.cases)('$name', (c) => {
		const listForm = 'listForm' in c ? (c.listForm as string) : undefined;
		expect(displayForm(c as DisplayEntry, listForm)).toBe(c.expected);
	});

	it('reads missing flags and tags as none', () => {
		const entry = { forms: [{ text: '食べる' }], readings: [{ type: 'kana', value: 'たべる' }] };
		expect(displayForm(entry)).toBe('食べる');
	});
});
