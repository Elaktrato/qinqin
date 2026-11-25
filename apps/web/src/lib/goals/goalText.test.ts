import { describe, expect, it } from 'vitest';
import type { ActivitySource } from '../api/stats';
import type { GoalMetric } from './goals';
import type { GoalDay } from './progress';
import { ariaText, metricOptions, progressText, shortText, statusLine, streakText } from './goalText';

// The built-in sources exactly as the plugin manifests declare them.
const SOURCES: ActivitySource[] = [
	{ type: 'read', feature: 'reader', unit: 'seconds' },
	{ type: 'review', feature: 'flashcards', unit: 'count' },
	{ type: 'journal', feature: 'journal', unit: 'count' }
];

function day(metric: GoalMetric | null, target: number | null, amount: number, status: GoalDay['status'] = 'open', unavailable = false): GoalDay {
	return { day: '2026-11-16', status, metric, target, amount, fraction: 0, unavailable };
}

describe('metricOptions', () => {
	it('lists reviews, new cards, study time, then other sources by label', () => {
		expect(metricOptions(SOURCES)).toEqual([
			{ metric: 'activity:review', label: 'Flashcard reviews', unit: 'count' },
			{ metric: 'flashcards:new', label: 'New cards', unit: 'count' },
			{ metric: 'flashcards:studyTime', label: 'Flashcard study time', unit: 'minutes' },
			{ metric: 'activity:journal', label: 'Journal entries', unit: 'count' },
			{ metric: 'activity:read', label: 'Reading', unit: 'minutes' }
		]);
	});

	it('leaves out reviews when no source counts them', () => {
		expect(metricOptions([]).map((o) => o.metric)).toEqual(['flashcards:new', 'flashcards:studyTime']);
	});
});

describe('progressText', () => {
	it('uses each built-in source template with "n of target"', () => {
		expect(progressText(day('activity:review', 50, 32), SOURCES)).toBe('32 of 50 flashcard reviews today');
		expect(progressText(day('activity:journal', 2, 1), SOURCES)).toBe('1 of 2 journal entries today');
		expect(progressText(day('activity:read', 20, 12), SOURCES)).toBe('12 of 20 minutes of reading today');
	});

	it('takes the plural form from the target', () => {
		expect(progressText(day('activity:review', 1, 0), SOURCES)).toBe('0 of 1 flashcard review today');
		expect(progressText(day('activity:read', 1, 3), SOURCES)).toBe('3 of 1 minute of reading today');
		expect(progressText(day('activity:journal', 1, 1), SOURCES)).toBe('1 of 1 journal entry today');
	});

	it('has built-in texts for the flashcards metrics', () => {
		expect(progressText(day('flashcards:new', 10, 3), SOURCES)).toBe('3 of 10 new cards today');
		expect(progressText(day('flashcards:new', 1, 0), SOURCES)).toBe('0 of 1 new card today');
		expect(progressText(day('flashcards:studyTime', 20, 5), SOURCES)).toBe('5 of 20 minutes of flashcard study today');
		expect(progressText(day('flashcards:studyTime', 1, 0), SOURCES)).toBe('0 of 1 minute of flashcard study today');
	});

	it('falls back to the type name for a source missing from the list', () => {
		expect(progressText(day('activity:quiz', 5, 2), SOURCES)).toBe('2 of 5 quiz today');
	});

	it('says so without a goal', () => {
		expect(progressText(day(null, null, 0, 'none'), SOURCES)).toBe('No daily goal');
	});
});

describe('shortText and ariaText', () => {
	it('shortText is amount/target', () => {
		expect(shortText(day('activity:review', 50, 32))).toBe('32/50');
		expect(shortText(day(null, null, 0, 'none'))).toBe('');
	});

	it('ariaText prefixes a reached goal', () => {
		expect(ariaText(day('activity:review', 50, 62, 'met'), SOURCES)).toBe('Goal reached: 62 of 50 flashcard reviews today');
		expect(ariaText(day('activity:review', 50, 32), SOURCES)).toBe('32 of 50 flashcard reviews today');
	});
});

describe('statusLine', () => {
	it('names the special states', () => {
		expect(statusLine(day('activity:review', 5, 5, 'met'))).toBe('Goal reached');
		expect(statusLine(day('activity:review', 5, 5, 'vacation'))).toBe('On vacation — goal paused');
		expect(statusLine(day('activity:quiz', 5, 0, 'none', true))).toBe("This goal's activity is no longer counted");
		expect(statusLine(day('activity:review', 5, 1, 'open'))).toBeNull();
		expect(statusLine(day(null, null, 0, 'none'))).toBeNull();
	});
});

describe('streakText', () => {
	it('words the goal streak', () => {
		expect(streakText({ current: 4, capped: false })).toBe('Goal streak: 4 days');
		expect(streakText({ current: 1, capped: false })).toBe('Goal streak: 1 day');
		expect(streakText({ current: 0, capped: false })).toBe('Goal streak: 0 days');
		// Capped: at least this many (vacation days are skipped, so not always 365).
		expect(streakText({ current: 366, capped: true })).toBe('Goal streak: 366+ days');
		expect(streakText({ current: 246, capped: true })).toBe('Goal streak: 246+ days');
		expect(streakText({ current: 4, capped: true })).toBe('Goal streak: 4+ days');
	});
});
