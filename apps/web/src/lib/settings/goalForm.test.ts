import { describe, expect, it } from 'vitest';
import type { GoalsRow } from '$lib/goals/goals';
import type { MetricOption } from '$lib/goals/goalText';
import { formFrom, limitHint, planForm, validateForm } from './goalForm';

const OPTIONS: MetricOption[] = [
	{ metric: 'activity:review', label: 'Flashcard reviews', unit: 'count' },
	{ metric: 'flashcards:new', label: 'New cards', unit: 'count' },
	{ metric: 'flashcards:studyTime', label: 'Flashcard study time', unit: 'minutes' },
	{ metric: 'activity:read', label: 'Reading', unit: 'minutes' }
];

const ROW: GoalsRow = {
	version: 1,
	showStreak: false,
	history: [
		{ from: '2026-11-01', metric: 'activity:review', target: 50 },
		{ from: '2026-11-20', metric: null, target: null }
	]
};

describe('formFrom', () => {
	it('reads the goal in effect today and the streak switch', () => {
		expect(formFrom(ROW, '2026-11-16')).toEqual({ metric: 'activity:review', target: '50', showStreak: false });
		expect(formFrom(ROW, '2026-11-21')).toEqual({ metric: '', target: '', showStreak: false });
		expect(formFrom(null, '2026-11-16')).toEqual({ metric: '', target: '', showStreak: true });
	});
});

describe('validateForm', () => {
	it('an empty metric is no goal', () => {
		expect(validateForm({ metric: '', target: 'x', showStreak: true }, OPTIONS)).toEqual({ edit: null });
	});

	it('accepts whole numbers in range', () => {
		expect(validateForm({ metric: 'activity:review', target: ' 9999 ', showStreak: true }, OPTIONS)).toEqual({
			edit: { metric: 'activity:review', target: 9999 }
		});
		expect(validateForm({ metric: 'activity:read', target: '1440', showStreak: true }, OPTIONS)).toEqual({
			edit: { metric: 'activity:read', target: 1440 }
		});
	});

	it('words the range error per unit', () => {
		for (const target of ['0', '1441', '1.5', '', 'ten', '-3']) {
			expect(validateForm({ metric: 'flashcards:studyTime', target, showStreak: true }, OPTIONS)).toEqual({
				error: 'Enter a whole number of minutes from 1 to 1440'
			});
		}
		for (const target of ['0', '10000', '2.5', '']) {
			expect(validateForm({ metric: 'flashcards:new', target, showStreak: true }, OPTIONS)).toEqual({
				error: 'Enter a whole number from 1 to 9999'
			});
		}
		expect(validateForm({ metric: 'activity:read', target: '1441', showStreak: true }, OPTIONS)).toEqual({
			error: 'Enter a whole number of minutes from 1 to 1440'
		});
	});

	it('refuses a metric that is not offered', () => {
		expect(validateForm({ metric: 'activity:quiz', target: '5', showStreak: true }, OPTIONS)).toEqual({
			error: 'Choose what to count'
		});
	});
});

describe('limitHint', () => {
	it('warns only for new cards above a finite limit', () => {
		const s = (metric: '' | 'flashcards:new' | 'activity:review', target: string) => ({ metric, target, showStreak: true });
		expect(limitHint(s('flashcards:new', '30'), 20)).toBe(
			'Your daily new-card limit is 20; raise it to reach this goal'
		);
		expect(limitHint(s('flashcards:new', '20'), 20)).toBeNull();
		expect(limitHint(s('flashcards:new', '30'), null)).toBeNull();
		expect(limitHint(s('activity:review', '300'), 20)).toBeNull();
		expect(limitHint(s('flashcards:new', 'x'), 20)).toBeNull();
		expect(limitHint(s('', ''), 20)).toBeNull();
	});
});

describe('planForm', () => {
	const today = '2026-11-16';
	it('writes nothing without a change', () => {
		expect(planForm(ROW, formFrom(ROW, today), OPTIONS, today)).toEqual({ row: null });
		expect(planForm(null, formFrom(null, today), OPTIONS, today)).toEqual({ row: null });
	});

	it('the streak switch alone changes only showStreak', () => {
		expect(planForm(ROW, { ...formFrom(ROW, today), showStreak: true }, OPTIONS, today)).toEqual({
			row: { ...ROW, showStreak: true }
		});
	});

	it('a new target and the switch are one write', () => {
		expect(planForm(ROW, { metric: 'activity:review', target: '60', showStreak: true }, OPTIONS, today)).toEqual({
			row: {
				version: 1,
				showStreak: true,
				history: [
					{ from: '2026-11-01', metric: 'activity:review', target: 50 },
					{ from: today, metric: 'activity:review', target: 60 },
					{ from: '2026-11-20', metric: null, target: null }
				]
			}
		});
	});

	it('passes the validation error on', () => {
		expect(planForm(null, { metric: 'flashcards:new', target: '0', showStreak: true }, OPTIONS, today)).toEqual({
			error: 'Enter a whole number from 1 to 9999'
		});
	});
});
