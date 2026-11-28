import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureSwitch } from '$lib/features/switches.svelte';
import { FLASHCARDS_ID, READER_ID } from '$lib/features';
import { DEFAULT_BAR, type NavLayout, type NavLayoutChange } from '$lib/frame/navLayout';
import { createNavLayoutStore } from '$lib/frame/navLayoutStore.svelte';
import NavLayoutSettings from './NavLayoutSettings.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const state = (id: string, _order: number, enabled = true): FeatureSwitch => ({ id, enabled });
// Home, Search, Decks, Reader, Journal, Grammar, Stats: seven sections.
const seven = [state(FLASHCARDS_ID, 0), state(READER_ID, 0), state('journal', 0), state('grammar', 1)];
// Home, Search, Decks, Reader, Stats: five fit.
const five = [state(FLASHCARDS_ID, 0), state(READER_ID, 0), state('journal', 0, false), state('grammar', 1, false), state('courses', 1, false)];

let saved: NavLayoutChange[];

function setup(initial: NavLayout = { phone: 'bar', bar: [...DEFAULT_BAR] }, saveImpl?: (c: NavLayoutChange) => Promise<NavLayout>) {
	const store = createNavLayoutStore({ load: async () => initial, storage: () => null });
	store.set(initial);
	const save = vi.fn(
		saveImpl ??
			(async (change: NavLayoutChange) => {
				saved.push(change);
				return { phone: change.phone ?? 'bar', bar: [...(change.bar ?? DEFAULT_BAR)] };
			})
	);
	const view = render(NavLayoutSettings, { props: { store, load: async () => initial, save }, context: ctx.context });
	return { store, save, ...view };
}

const rowNames = () =>
	[...document.querySelectorAll('.items > li')].map((li) => li.querySelector('strong')?.textContent);
const previewNames = () =>
	within(screen.getByRole('list', { name: 'The bottom bar on a phone' }))
		.getAllByRole('listitem')
		.map((li) => li.textContent?.trim());

beforeEach(() => {
	saved = [];
	ctx.session.features.set({ list: seven, status: 'ready' });
});
afterEach(() => {
	cleanup();
	ctx.session.features.set({ list: [], status: 'idle' });
});

describe('Settings → Layout: phone navigation', () => {
	it('two choices, Bottom bar checked by default, each with a one-line description', () => {
		setup();
		const bar = screen.getByRole('radio', { name: 'Bottom bar' }) as HTMLInputElement;
		const drawer = screen.getByRole('radio', { name: 'Side menu' }) as HTMLInputElement;
		expect(bar.checked).toBe(true);
		expect(drawer.checked).toBe(false);
		expect(document.getElementById(drawer.getAttribute('aria-describedby')!)?.textContent).toMatch(/slides in/);
	});

	it('choosing Side menu shows at once (the frame follows the store) and saves only phone', async () => {
		const { store } = setup();
		await fireEvent.click(screen.getByRole('radio', { name: 'Side menu' }));
		expect(store.phone).toBe('drawer');
		await waitFor(() => expect(saved).toEqual([{ phone: 'drawer' }]));
		expect(screen.getByText('Phone navigation: Side menu.')).toBeTruthy();
	});
});

describe('Settings → Layout: the bottom bar', () => {
	it('lists the visible sections: pins first in bar order, then the others in frame order', () => {
		setup();
		expect(rowNames()).toEqual(['Home', 'Decks', 'Reader', 'Search', 'Journal', 'Grammar', 'Courses', 'Stats']);
		expect((screen.getByRole('switch', { name: 'In the bar Reader' }) as HTMLInputElement).checked).toBe(true);
		expect((screen.getByRole('switch', { name: 'In the bar Journal' }) as HTMLInputElement).checked).toBe(false);
	});

	it('explains the five-item rule in one line: four then More, or all when they fit', () => {
		setup();
		expect(screen.getByText('Up to four sections, then More with the rest.')).toBeTruthy();
		cleanup();
		ctx.session.features.set({ list: five, status: 'ready' });
		setup();
		expect(screen.getByText('All your sections fit, so the bar shows them all.')).toBeTruthy();
		expect(previewNames()).toEqual(['Home', 'Decks', 'Reader', 'Search', 'Stats']);
	});

	it('the live preview follows the switches; a fifth pin goes under More', async () => {
		const { store } = setup();
		expect(previewNames()).toEqual(['Home', 'Decks', 'Reader', 'Search', 'More']);
		await fireEvent.click(screen.getByRole('switch', { name: 'In the bar Journal' }));
		expect(store.bar).toEqual([...DEFAULT_BAR, 'journal']);
		expect(screen.getByText('Under More')).toBeTruthy();
		await fireEvent.click(screen.getByRole('switch', { name: 'In the bar Decks' }));
		expect(previewNames()).toEqual(['Home', 'Reader', 'Search', 'Journal', 'More']);
		await waitFor(() => expect(saved.at(-1)).toEqual({ bar: ['home', 'reader', 'search', 'journal'] }));
		// The switch keeps focus after its row moves between the groups.
		expect(document.activeElement).toBe(screen.getByRole('switch', { name: 'In the bar Decks' }));
	});

	it('Move up / Move down reorder the pins (named per section), disabled at the ends, focus kept', async () => {
		const { store } = setup();
		expect((screen.getByRole('button', { name: 'Move Home up' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'Move Search down' }) as HTMLButtonElement).disabled).toBe(true);
		const up = screen.getByRole('button', { name: 'Move Search up' });
		await fireEvent.click(up);
		expect(store.bar).toEqual(['home', 'flashcards', 'search', 'reader']);
		expect(screen.getByText('Search moved to position 3 of 4.')).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Search up' })));
		// Sections not in the bar have no move buttons.
		expect(screen.queryByRole('button', { name: 'Move Journal up' })).toBeNull();
	});

	it('a pin of a switched-off section stays stored when the bar is edited', async () => {
		const { store } = setup({ phone: 'bar', bar: ['home', 'cards-plus', 'reader'] });
		await fireEvent.click(screen.getByRole('button', { name: 'Move Reader up' }));
		expect(store.bar).toEqual(['reader', 'cards-plus', 'home']);
	});

	it('Reset to default goes back to Home, Decks, Reader, Search; disabled when already default', async () => {
		const { store } = setup({ phone: 'drawer', bar: ['stats'] });
		const reset = screen.getByRole('button', { name: 'Reset to default' }) as HTMLButtonElement;
		expect(reset.disabled).toBe(false);
		await fireEvent.click(reset);
		expect(store.layout).toEqual({ phone: 'drawer', bar: [...DEFAULT_BAR] });
		await waitFor(() => expect(saved).toEqual([{ bar: [...DEFAULT_BAR] }]));
		expect(reset.disabled).toBe(true);
	});

	it('the side menu is chosen: a note says the choices apply to the bottom bar', () => {
		setup({ phone: 'drawer', bar: [...DEFAULT_BAR] });
		expect(screen.getByText(/You use the side menu now/)).toBeTruthy();
	});

	it('the section heading is the "Edit the bar" target', () => {
		setup();
		expect(document.getElementById('bottom-bar')?.textContent).toBe('Bottom bar');
	});

	it('a failed save says so, keeps the change, and Retry sends it again', async () => {
		let fail = true;
		const { store, save } = setup(undefined, async (change) => {
			if (fail) throw new Error('offline');
			saved.push(change);
			return { phone: 'drawer', bar: [...DEFAULT_BAR] };
		});
		await fireEvent.click(screen.getByRole('radio', { name: 'Side menu' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/Could not save/);
		expect(store.phone).toBe('drawer');
		fail = false;
		await fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
		await waitFor(() => expect(saved).toEqual([{ phone: 'drawer' }]));
		expect(save).toHaveBeenCalledTimes(2);
		await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
	});

	it('changes made while a save is in flight are merged and sent after it', async () => {
		let release: () => void = () => {};
		let first = true;
		setup(undefined, async (change) => {
			if (first) {
				first = false;
				await new Promise<void>((r) => (release = r));
			}
			saved.push(change);
			return { phone: 'bar', bar: [...DEFAULT_BAR] };
		});
		await fireEvent.click(screen.getByRole('radio', { name: 'Side menu' }));
		await fireEvent.click(screen.getByRole('switch', { name: 'In the bar Stats' }));
		release();
		await waitFor(() => expect(saved).toHaveLength(2));
		expect(saved[1]).toEqual({ bar: [...DEFAULT_BAR, 'stats'] });
	});

	it('leaving Settings with an unsaved change re-reads the row, so the frame shows what is saved', async () => {
		const { store, unmount } = setup(undefined, async () => {
			throw new Error('offline');
		});
		const reload = vi.spyOn(store, 'reload');
		await fireEvent.click(screen.getByRole('radio', { name: 'Side menu' }));
		await screen.findByRole('alert');
		unmount();
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('the mount read never overwrites a change made before it lands', async () => {
		let answer: (v: NavLayout) => void = () => {};
		const store = createNavLayoutStore({ load: async () => ({ phone: 'bar', bar: [...DEFAULT_BAR] }), storage: () => null });
		render(NavLayoutSettings, { props: {
			store,
			load: () => new Promise<NavLayout>((resolve) => (answer = resolve)),
			save: async (c: NavLayoutChange) => ({ phone: c.phone ?? 'bar', bar: [...DEFAULT_BAR] })
		}, context: ctx.context });
		await fireEvent.click(screen.getByRole('radio', { name: 'Side menu' }));
		answer({ phone: 'bar', bar: [...DEFAULT_BAR] });
		await new Promise((r) => setTimeout(r));
		expect(store.phone).toBe('drawer');
	});
});
