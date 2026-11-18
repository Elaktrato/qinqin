import { describe, expect, it } from 'vitest';
import { markTerm } from './markTerm';

describe('markTerm (#104)', () => {
	it('splits around every occurrence of the word', () => {
		expect(markTerm('他每天都勤奋地学习，勤奋是好事。', '勤奋')).toEqual([
			{ text: '他每天都', match: false },
			{ text: '勤奋', match: true },
			{ text: '地学习，', match: false },
			{ text: '勤奋', match: true },
			{ text: '是好事。', match: false }
		]);
	});

	it('returns one plain segment when the word is absent', () => {
		expect(markTerm('他学习。', '勤奋')).toEqual([{ text: '他学习。', match: false }]);
	});

	it('never returns an empty segment', () => {
		expect(markTerm('勤奋勤奋', '勤奋')).toEqual([
			{ text: '勤奋', match: true },
			{ text: '勤奋', match: true }
		]);
		expect(markTerm('', '勤奋')).toEqual([]);
		expect(markTerm('勤奋', '')).toEqual([{ text: '勤奋', match: false }]);
	});
});
