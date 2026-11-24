import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActivitySource } from '../api/stats';
import type { GoalDay } from './progress';
import GoalRing from './GoalRing.svelte';

const SOURCES: ActivitySource[] = [
	{
		type: 'review',
		feature: 'flashcards',
		unit: 'count'
	}
];

function day(partial: Partial<GoalDay>): GoalDay {
	return {
		day: '2026-11-16',
		status: 'open',
		metric: 'activity:review',
		target: 50,
		amount: 32,
		fraction: 0.64,
		unavailable: false,
		...partial
	};
}

afterEach(() => cleanup());

describe('GoalRing', () => {
	it('is a progressbar whose value text is the visible text', () => {
		const { container } = render(GoalRing, { day: day({}), sources: SOURCES });
		const bar = screen.getByRole('progressbar');
		expect(bar.getAttribute('aria-valuemin')).toBe('0');
		expect(bar.getAttribute('aria-valuemax')).toBe('50');
		expect(bar.getAttribute('aria-valuenow')).toBe('32');
		expect(bar.getAttribute('aria-valuetext')).toBe('32 of 50 flashcard reviews today');
		expect(screen.getByText('32 of 50 flashcard reviews today')).toBeTruthy();
		expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
		expect(container.querySelector('.reached')).toBeNull();
	});

	it('caps the value at the target and shows the reached state in words', () => {
		const { container } = render(GoalRing, {
			day: day({ status: 'met', amount: 62, fraction: 1 }),
			sources: SOURCES
		});
		const bar = screen.getByRole('progressbar');
		expect(bar.getAttribute('aria-valuenow')).toBe('50');
		const text = 'Goal reached: 62 of 50 flashcard reviews today';
		expect(bar.getAttribute('aria-valuetext')).toBe(text);
		expect(container.querySelector('.text')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(text);
		expect(container.querySelector('.reached')).not.toBeNull();
		expect(container.querySelector('.check')?.textContent).toBe('✓');
	});

	it('shows only the status line on vacation, without a goal and when unavailable', () => {
		render(GoalRing, { day: day({ status: 'vacation', fraction: 0 }), sources: SOURCES });
		expect(screen.queryByRole('progressbar')).toBeNull();
		expect(screen.getByText('On vacation — goal paused')).toBeTruthy();
		cleanup();

		const none = render(GoalRing, {
			day: day({ status: 'none', metric: null, target: null, amount: 0, fraction: 0 }),
			sources: SOURCES
		});
		expect(screen.queryByRole('progressbar')).toBeNull();
		expect(none.container.textContent?.trim()).toBe('');
		cleanup();

		render(GoalRing, {
			day: day({ status: 'none', metric: 'activity:quiz', target: 5, amount: 0, fraction: 0, unavailable: true }),
			sources: SOURCES
		});
		expect(screen.queryByRole('progressbar')).toBeNull();
		expect(screen.getByText("This goal's activity is no longer counted")).toBeTruthy();
	});

	it('small size shows the short text and keeps the full value text', () => {
		render(GoalRing, { day: day({}), sources: SOURCES, size: 'small' });
		const bar = screen.getByRole('progressbar');
		expect(bar.getAttribute('aria-valuetext')).toBe('32 of 50 flashcard reviews today');
		expect(screen.getByText('32/50')).toBeTruthy();
	});

	it('small size says "Goal reached" in words when met', () => {
		const { container } = render(GoalRing, {
			day: day({ status: 'met', amount: 62, fraction: 1 }),
			sources: SOURCES,
			size: 'small'
		});
		expect(screen.getByText('Goal reached')).toBeTruthy();
		expect(screen.getByText('62/50')).toBeTruthy();
		expect(container.querySelector('.check')?.textContent).toBe('✓');
		cleanup();
		render(GoalRing, { day: day({}), sources: SOURCES, size: 'small' });
		expect(screen.queryByText('Goal reached')).toBeNull();
	});

	it('turns the arc transition off under reduced motion', () => {
		const source = readFileSync(resolve(__dirname, 'GoalRing.svelte'), 'utf8');
		const style = source.slice(source.indexOf('<style>'));
		expect(style).toMatch(/transition:\s*stroke-dashoffset/);
		expect(style).toMatch(
			/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.fill\s*\{\s*transition:\s*none;/
		);
	});
});
