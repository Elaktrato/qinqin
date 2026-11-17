import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import MilestoneHistory from './MilestoneHistory.svelte';

afterEach(() => cleanup());

const TITLES = new Map([
	['days-active:10', '10 days active'],
	['streak:7', '7-day streak'],
	['reviews:100', '100 reviews']
]);

describe('MilestoneHistory', () => {
	it('is an ordered list, newest first, "New" as text', () => {
		render(MilestoneHistory, {
			items: [
				{ id: 'days-active:10', day: '2026-11-12', isNew: true },
				{ id: 'streak:7', day: '2026-11-10', isNew: false },
				{ id: 'reviews:100', day: '2026-11-03', isNew: false }
			],
			titles: TITLES,
			locale: 'en-GB'
		});
		const list = document.querySelector('ol')!;
		const items = [...list.querySelectorAll('li')].map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
		expect(items).toEqual([
			'10 days active, reached 12 November 2026 New',
			'7-day streak, reached 10 November 2026',
			'100 reviews, reached 3 November 2026'
		]);
		expect(screen.getByText('New').tagName).not.toBe('svg');
	});

	it('the empty state', () => {
		render(MilestoneHistory, { items: [], titles: new Map() });
		expect(screen.getByText('No milestones yet.')).toBeTruthy();
		expect(document.querySelector('ol')).toBeNull();
	});

	it('an item without a title is not shown', () => {
		render(MilestoneHistory, { items: [{ id: 'reviews:7', day: '2026-11-12', isNew: false }], titles: new Map() });
		expect(document.querySelectorAll('li')).toHaveLength(0);
	});
});
