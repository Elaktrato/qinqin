import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import MilestoneHistory from './MilestoneHistory.svelte';
import source from './MilestoneHistory.svelte?raw';

afterEach(() => cleanup());

const TITLES = new Map([
	['days-active:10', '10 days active'],
	['streak:7', '7-day streak'],
	['reviews:100', '100 reviews']
]);

describe('MilestoneHistory', () => {
	it('renders the items in the given newest-first order, "New" as text', () => {
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
		const items = [...list.querySelectorAll('li')].map((li) => ({
			title: li.querySelector('.title')?.textContent,
			date: li.querySelector('.date')?.textContent,
			isNew: li.querySelector('.new')?.textContent ?? null
		}));
		expect(items).toEqual([
			{ title: '10 days active', date: 'reached 12 November 2026', isNew: 'New' },
			{ title: '7-day streak', date: 'reached 10 November 2026', isNew: null },
			{ title: '100 reviews', date: 'reached 3 November 2026', isNew: null }
		]);
		expect(screen.getByText('New').tagName).not.toBe('svg');
		// Plain rows with a hairline, no bordered pill.
		const css = source.slice(source.indexOf('<style>'));
		expect(css).not.toMatch(/border-radius:\s*999px/);
		expect(css).toMatch(/border-top: 1px solid var\(--hair\)/);
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
