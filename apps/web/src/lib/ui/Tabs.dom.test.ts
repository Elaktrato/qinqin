import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import Tabs from './Tabs.svelte';
import TabsHarness from './testing/TabsHarness.svelte';
import source from './Tabs.svelte?raw';

const TABS = [
	{ id: 'overview', label: 'Overview' },
	{ id: 'characters', label: 'Characters' },
	{ id: 'week', label: 'Week' }
];

describe('Tabs (in-page)', () => {
	it('is a named tablist with one selected, focusable tab', () => {
		render(Tabs, { label: 'Stats views', tabs: TABS, selected: 'characters' });
		expect(screen.getByRole('tablist', { name: 'Stats views' })).toBeTruthy();
		const tabs = screen.getAllByRole('tab');
		expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
		expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
	});

	it('arrows move selection and focus, wrapping; Home and End jump', async () => {
		const onselect = vi.fn();
		render(Tabs, { label: 'Views', tabs: TABS, selected: 'overview', onselect });
		const first = screen.getByRole('tab', { name: 'Overview' });
		first.focus();
		await fireEvent.keyDown(first, { key: 'ArrowLeft' });
		const week = screen.getByRole('tab', { name: 'Week' });
		expect(week.getAttribute('aria-selected')).toBe('true');
		expect(document.activeElement).toBe(week);
		await fireEvent.keyDown(week, { key: 'ArrowRight' });
		expect(document.activeElement).toBe(first);
		await fireEvent.keyDown(first, { key: 'End' });
		expect(document.activeElement).toBe(week);
		await fireEvent.keyDown(week, { key: 'Home' });
		expect(document.activeElement).toBe(first);
		expect(onselect.mock.calls.map((c) => c[0])).toEqual(['week', 'overview', 'week', 'overview']);
	});

	it('a click selects; the panel is labelled by the selected tab and controlled by it', async () => {
		render(TabsHarness);
		await fireEvent.click(screen.getByRole('tab', { name: 'Week' }));
		const panel = screen.getByRole('tabpanel');
		const week = screen.getByRole('tab', { name: 'Week' });
		expect(panel.getAttribute('aria-labelledby')).toBe(week.id);
		expect(week.getAttribute('aria-controls')).toBe(panel.id);
		expect(panel.getAttribute('tabindex')).toBe('0');
		expect(panel.textContent).toBe('Panel for week');
		expect(screen.getByTestId('bound').textContent).toBe('week');
	});
});

describe('Tabs (routes)', () => {
	it('renders links in a named nav, the current one aria-current', () => {
		const tabs = TABS.map((t) => ({ ...t, href: `/stats/${t.id}` }));
		render(Tabs, { label: 'Stats views', tabs, selected: 'week' });
		expect(screen.getByRole('navigation', { name: 'Stats views' })).toBeTruthy();
		expect(screen.queryByRole('tablist')).toBeNull();
		const links = screen.getAllByRole('link');
		expect(links.map((l) => l.getAttribute('aria-current'))).toEqual([null, null, 'page']);
		expect(links[0].getAttribute('href')).toBe('/stats/overview');
	});
});

describe('Tabs look', () => {
	it('selected: strong text with a 2px accent underline; others readable-muted', () => {
		const css = source.slice(source.indexOf('<style>'));
		expect(css).toMatch(/\[aria-selected='true'\][^{]*\{[^}]*color: var\(--text\)/);
		expect(css).toMatch(/height: 2px;[^}]*background: var\(--accent\)|background: var\(--accent\);[^}]*height: 2px/);
		expect(css).toMatch(/color: var\(--readable-muted\)/);
		expect(css).toMatch(/@media \(forced-colors: active\)/);
	});
});
