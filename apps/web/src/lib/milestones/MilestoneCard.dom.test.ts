import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MilestonesView } from './loadMilestones';
import MilestoneCard from './MilestoneCard.svelte';
import type { CardPlan } from './plan';

afterEach(() => {
	cleanup();
	document.body.innerHTML = '';
});

const r = (id: string, day: string) => ({ id, at: Date.parse(`${day}T09:00:00Z`), day });
const TITLES = new Map([
	['reviews:1000', '1,000 reviews'],
	['streak:7', '7-day streak'],
	['streak:3', '3-day streak'],
	['days-active:10', '10 days active'],
	['journal-entries:1', '1 journal entry']
]);

function view(plan: CardPlan): MilestonesView {
	return { workspaceId: 1, plan, history: [], titles: TITLES, reached: [], live: new Map() };
}

function withH1(): HTMLHeadingElement {
	const h1 = document.createElement('h1');
	h1.textContent = 'qinqin';
	document.body.prepend(h1);
	return h1;
}

describe('MilestoneCard', () => {
	it('renders nothing but the status container for no card', () => {
		const { container } = render(MilestoneCard, { view: view({ kind: 'none' }), ondismiss: () => {} });
		expect(container.querySelector('[role="status"]')).not.toBeNull();
		expect(container.querySelector('section')).toBeNull();
	});

	it('recent: names each milestone with its date, in a labelled section inside a status container', () => {
		const items = [r('streak:7', '2026-11-16'), r('reviews:1000', '2026-11-03')];
		render(MilestoneCard, { view: view({ kind: 'recent', items, ids: items.map((i) => i.id) }), ondismiss: () => {}, locale: 'en-GB' });
		const section = document.querySelector('section')!;
		const heading = screen.getByRole('heading', { level: 2, name: '2 milestones reached' });
		expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
		expect(section.closest('[role="status"]')).not.toBeNull();
		expect(screen.getByText('7-day streak, reached 16 November 2026')).toBeTruthy();
		expect(screen.getByText('1,000 reviews, reached 3 November 2026')).toBeTruthy();
		expect(document.querySelector('.icon')?.getAttribute('aria-hidden')).toBe('true');
		expect(screen.queryByRole('link')).toBeNull();
	});

	it('summary: three names, "and N more" and the link to the history', () => {
		const named = [r('journal-entries:1', '2026-11-15'), r('days-active:10', '2026-11-14'), r('streak:3', '2026-11-13')];
		render(MilestoneCard, {
			view: view({ kind: 'summary', count: 14, named, more: 11, ids: [] }),
			ondismiss: () => {},
			locale: 'en-GB'
		});
		expect(screen.getByRole('heading', { level: 2, name: 'You have reached 14 milestones' })).toBeTruthy();
		expect(document.querySelectorAll('li')).toHaveLength(3);
		expect(screen.getByText('and 11 more')).toBeTruthy();
		const link = screen.getByRole('link', { name: 'See all milestones' });
		expect(link.getAttribute('href')).toBe('/stats/week#milestones');
	});

	it('Dismiss calls ondismiss and moves focus to the page heading', async () => {
		const h1 = withH1();
		const ondismiss = vi.fn();
		const items = [r('streak:7', '2026-11-16')];
		render(MilestoneCard, { view: view({ kind: 'recent', items, ids: ['streak:7'] }), ondismiss });
		const button = screen.getByRole('button', { name: 'Dismiss' });
		expect(button.getAttribute('aria-describedby')).toBe(screen.getByRole('heading', { level: 2 }).id);
		button.focus();
		await fireEvent.click(button);
		expect(ondismiss).toHaveBeenCalledTimes(1);
		expect(document.activeElement).toBe(h1);
	});

	it('following the link also marks the milestones', async () => {
		const ondismiss = vi.fn();
		render(MilestoneCard, {
			view: view({ kind: 'summary', count: 4, named: [r('streak:7', '2026-11-16')], more: 3, ids: [] }),
			ondismiss
		});
		const link = screen.getByRole('link', { name: 'See all milestones' });
		link.addEventListener('click', (e) => e.preventDefault());
		await fireEvent.click(link);
		expect(ondismiss).toHaveBeenCalledTimes(1);
	});
});
