import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import source from './ReaderRail.svelte?raw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReaderRail from './ReaderRail.svelte';
import type { RailTab } from './railState';

afterEach(cleanup);

const style = source.slice(source.indexOf('<style>'));

const TABS = [
	{ id: 'contents' as const, label: 'Contents', icon: 'contents' as const },
	{ id: 'bookmarks' as const, label: 'Bookmarks', icon: 'bookmark' as const },
	{ id: 'highlights' as const, label: 'Highlights', icon: 'highlight' as const },
	{ id: 'words' as const, label: 'Words', icon: 'words' as const },
	{ id: 'display' as const, label: 'Display', icon: 'display' as const }
];

const panel = createRawSnippet((tab: () => RailTab) => ({
	render: () => `<p>${tab()} panel</p>`
}));

function mount(over: Record<string, unknown> = {}) {
	const onSelect = vi.fn();
	const onToggle = vi.fn();
	const props: Record<string, unknown> = { tabs: TABS, active: 'bookmarks', open: true, mode: 'column', ...over };
	const view = render(ReaderRail, {
		...props,
		onSelect: (tab: RailTab) => {
			onSelect(tab);
			props.active = tab;
			void view.rerender({ active: tab } as never);
		},
		onToggle: (open: boolean) => {
			onToggle(open);
			props.open = open;
			void view.rerender({ open } as never);
		},
		panel
	} as never);
	return { onSelect, onToggle, props };
}

describe('ReaderRail (column mode)', () => {
	it('five tabs in a vertical tablist, each named by its label, each with a tooltip on hover and focus', async () => {
		mount();
		const list = screen.getByRole('tablist');
		expect(list.getAttribute('aria-orientation')).toBe('vertical');
		const tabs = within(list).getAllByRole('tab');
		expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual([
			'Contents',
			'Bookmarks',
			'Highlights',
			'Words',
			'Display'
		]);
		for (const tab of tabs) expect(tab.querySelector('svg')).toBeTruthy();
		const tip = (tab: HTMLElement) => tab.parentElement!.querySelector('[role="tooltip"]') as HTMLElement;
		expect(tip(tabs[3]).textContent).toBe('Words');
		expect(tip(tabs[3]).classList.contains('start')).toBe(true);
		await fireEvent.pointerEnter(tabs[3].parentElement!);
		expect(tip(tabs[3]).dataset.open).toBe('true');
		await fireEvent.pointerLeave(tabs[3].parentElement!);
		tabs[0].focus();
		await tick();
		expect(tip(tabs[0]).dataset.open).toBe('true');
	});

	it('arrow keys, Home and End move and select (roving tabindex)', async () => {
		const { onSelect } = mount();
		const tab = (name: string) => screen.getByRole('tab', { name });
		expect(tab('Bookmarks').tabIndex).toBe(0);
		expect(tab('Words').tabIndex).toBe(-1);
		await fireEvent.keyDown(tab('Bookmarks'), { key: 'ArrowDown' });
		expect(onSelect).toHaveBeenLastCalledWith('highlights');
		expect(document.activeElement).toBe(tab('Highlights'));
		expect(tab('Highlights').tabIndex).toBe(0);
		await fireEvent.keyDown(tab('Highlights'), { key: 'End' });
		expect(onSelect).toHaveBeenLastCalledWith('display');
		await fireEvent.keyDown(tab('Display'), { key: 'Home' });
		expect(onSelect).toHaveBeenLastCalledWith('contents');
		await fireEvent.keyDown(tab('Contents'), { key: 'ArrowUp' });
		expect(onSelect).toHaveBeenLastCalledWith('display');
	});

	it('activating the open tab collapses the panel and sets aria-expanded false on it; activating another opens it', async () => {
		const { onToggle, onSelect } = mount();
		const bookmarks = screen.getByRole('tab', { name: 'Bookmarks' });
		expect(bookmarks.getAttribute('aria-expanded')).toBe('true');
		expect(screen.getByText('bookmarks panel')).toBeTruthy();
		await fireEvent.click(bookmarks);
		expect(onToggle).toHaveBeenLastCalledWith(false);
		expect(bookmarks.getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByRole('tabpanel')).toBeNull();
		// The icon column stays.
		expect(screen.getAllByRole('tab')).toHaveLength(5);
		await fireEvent.click(screen.getByRole('tab', { name: 'Words' }));
		expect(onSelect).toHaveBeenLastCalledWith('words');
		expect(onToggle).toHaveBeenLastCalledWith(true);
		expect(screen.getByRole('tab', { name: 'Words' }).getAttribute('aria-expanded')).toBe('true');
		expect(screen.getByText('words panel')).toBeTruthy();
		// A collapsed rail reopens on its own tab too.
		await fireEvent.click(screen.getByRole('tab', { name: 'Words' }));
		await fireEvent.click(screen.getByRole('tab', { name: 'Words' }));
		expect(onToggle).toHaveBeenLastCalledWith(true);
	});

	it('an alert tab has "(needs attention)" in its name and a dot', () => {
		mount({ tabs: TABS.map((tab) => (tab.id === 'highlights' ? { ...tab, alert: true } : tab)) });
		const tab = screen.getByRole('tab', { name: 'Highlights (needs attention)' });
		expect(tab.parentElement!.parentElement!.querySelector('.dot')).toBeTruthy();
		expect(screen.getByRole('tab', { name: 'Bookmarks' })).toBeTruthy();
	});

	it('the panel is a tabpanel labelled by its tab', () => {
		mount({ active: 'words' });
		const panelEl = screen.getByRole('tabpanel');
		const tab = screen.getByRole('tab', { name: 'Words' });
		expect(panelEl.getAttribute('aria-labelledby')).toBe(tab.id);
		expect(tab.getAttribute('aria-controls')).toBe(panelEl.id);
		expect(panelEl.textContent).toContain('words panel');
	});
});

describe('ReaderRail (sheet mode)', () => {
	it('renders nothing in the page while closed', () => {
		mount({ mode: 'sheet', open: false });
		expect(screen.queryByRole('tablist')).toBeNull();
		expect(screen.queryByRole('tab')).toBeNull();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('open, it is the shared Sheet named "Book tools" with the five tabs as text tabs', async () => {
		const { onToggle } = mount({ mode: 'sheet', open: true, active: 'highlights' });
		const dialog = screen.getByRole('dialog', { name: 'Book tools' });
		const tabs = within(dialog).getAllByRole('tab');
		expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Contents', 'Bookmarks', 'Highlights', 'Words', 'Display']);
		expect(within(dialog).getByRole('tab', { name: /Highlights/ }).getAttribute('aria-selected')).toBe('true');
		expect(within(dialog).getByRole('tabpanel').textContent).toContain('highlights panel');
		await fireEvent.click(within(dialog).getByRole('tab', { name: /Words/ }));
		expect(within(dialog).getByRole('tab', { name: /Words/ }).getAttribute('aria-selected')).toBe('true');
		expect(within(dialog).getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
			within(dialog).getByRole('tab', { name: /Words/ }).id
		);
		await fireEvent.keyDown(dialog, { key: 'Escape' });
		expect(onToggle).toHaveBeenLastCalledWith(false);
		expect(screen.queryByRole('dialog')).toBeNull();
	});
});

describe('ReaderRail styles', () => {
	it('marks the active tab with --accent, the panel start line with --hair, motion with --motion-medium, and has a forced-colours block', () => {
		expect(style).toMatch(/aria-selected='true'\][^{]*::after\s*{[^}]*var\(--accent\)/);
		expect(style).toMatch(/border-inline-start:\s*1px solid var\(--hair\)/);
		expect(style).toMatch(/var\(--motion-medium\)/);
		const forced = style.slice(style.indexOf('@media (forced-colors: active)'));
		expect(forced).toMatch(/Highlight/);
		expect(forced).toMatch(/ButtonText/);
		expect(source).toMatch(/import \{[^}]*Sheet[^}]*\} from '\$lib\/ui'|import Sheet from '\$lib\/ui\/Sheet.svelte'/);
	});
});
