import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/frequency/display-form.json';
import { displayForm, readingBeside, shownWritten, type DisplayEntry } from './displayForm';

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

describe('shownWritten', () => {
	const inu = { written: '犬', readings: [{ type: 'kana', value: 'いぬ' }] };
	it('takes a kana snapshot that is a reading, else the live form', () => {
		expect(shownWritten(inu, 'いぬ')).toBe('いぬ');
		expect(shownWritten(inu, '狗')).toBe('犬');
		expect(shownWritten(inu, undefined)).toBe('犬');
		expect(shownWritten({ ...inu, readings: [{ type: 'kana', value: 'いぬ', flags: ['sk'] }] }, 'いぬ')).toBe('犬');
	});
});

describe('readingBeside', () => {
	it('is the first reading, empty when the word is already written that way', () => {
		const r = [{ type: 'kana', value: 'こと' }];
		expect(readingBeside('事', r)).toBe('こと');
		expect(readingBeside('こと', r)).toBe('');
		expect(readingBeside('の', [])).toBe('');
		expect(readingBeside('好', [{ value: 'hǎo' }])).toBe('hǎo');
	});
});
