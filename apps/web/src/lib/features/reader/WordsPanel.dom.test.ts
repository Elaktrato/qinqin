import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WordsPanel from './WordsPanel.svelte';
import type { Coverage, UnknownItem } from './coverage';

afterEach(cleanup);

const coverage: Coverage = { tokens: 10, known: 7, learning: 1, new: 2, types: { new: 2, learning: 1 }, unmatched: 1, percent: 70 };
const item = (entryId: number, lemma: string, count: number, state: 'new' | 'learning'): UnknownItem => ({
	entryId,
	lemma,
	count,
	state,
	reading: `r${entryId}`,
	first: { chapter: 0, p: 0, start: entryId }
});
const list = [item(1, '猫', 3, 'new'), item(2, '狗', 2, 'learning'), item(3, '鸟', 1, 'new')];

function mount(over: Record<string, unknown> = {}) {
	const onadd = vi.fn(async (ids: number[]) => ({ created: ids.length, joined: 0, skipped: 0, missing: 0 }));
	const undo = vi.fn(async () => {});
	const onmark = vi.fn(async (ids: number[]) => ({ written: ids, undo }));
	const oncountbook = vi.fn();
	const oncancelbook = vi.fn();
	const onretry = vi.fn();
	const props = {
		resetKey: '1:0:original:7',
		cards: 'ready',
		oncardsretry: vi.fn(),
		lang: 'zh',
		chapter: { coverage, list },
		progress: { done: 3, total: 3 },
		failed: 0,
		onretry,
		book: null,
		bookProgress: null,
		bookFailed: 0,
		oncountbook,
		oncancelbook,
		decks: [{ id: 'D1', name: 'Reading', createdAt: '2026-01-01T00:00:00Z' }],
		onadd,
		onmark,
		...over
	};
	const r = render(WordsPanel, props as never);
	return { ...r, onadd, onmark, undo, oncountbook, oncancelbook, onretry };
}

describe('WordsPanel', () => {
	it('shows progress until the chapter is counted, then the figure', async () => {
		const r = mount({ chapter: null, progress: { done: 1, total: 4 } });
		expect(screen.getByText('Counting… 1 of 4 parts')).toBeTruthy();
		await r.rerender({ chapter: { coverage, list }, progress: { done: 4, total: 4 } });
		expect(screen.getByText('You know 70% of the words in this chapter')).toBeTruthy();
		expect(screen.getByText('7 of 10 words · 2 different new words · 1 learning')).toBeTruthy();
		expect(screen.getByText('1 passage is not in the dictionary')).toBeTruthy();
	});

	it('failed parts offer Try again', async () => {
		const { onretry } = mount({ chapter: null, progress: { done: 2, total: 3 }, failed: 1 });
		expect(screen.getByText(/Some parts could not be counted/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		expect(onretry).toHaveBeenCalled();
	});

	it('lists the words as labelled checkboxes in a list, with reading, count and state', () => {
		mount();
		const items = screen.getAllByRole('listitem');
		expect(items).toHaveLength(3);
		expect(screen.getByRole('checkbox', { name: '猫' })).toBeTruthy();
		expect(items[0].textContent).toContain('r1');
		expect(items[0].textContent).toContain('×3');
		expect(items[0].textContent).toContain('New');
		expect(items[1].textContent).toContain('Learning');
		expect(items[0].closest('ul')).toBeTruthy();
	});

	it("the study text carries the book's lang; the interface text does not", () => {
		mount();
		expect(screen.getByText('猫').getAttribute('lang')).toBe('zh');
		expect(screen.getByText('r1').getAttribute('lang')).toBe('zh');
		// Interface text (state and count) carries none.
		expect(screen.getByText('×3').getAttribute('lang')).toBeNull();
		expect(screen.getAllByText('New')[0].getAttribute('lang')).toBeNull();
	});

	it('adds the selection and all new words to the chosen deck', async () => {
		const { onadd } = mount();
		await fireEvent.click(screen.getByRole('checkbox', { name: '狗' }));
		await fireEvent.change(screen.getByRole('combobox', { name: 'Deck' }), { target: { value: 'D1' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add selected (1)' }));
		expect(onadd).toHaveBeenLastCalledWith([2], { id: 'D1', name: 'Reading' });
		await screen.findByText('Added 1 word to Reading');
		await fireEvent.click(screen.getByRole('button', { name: 'Add all new words (2)' }));
		expect(onadd).toHaveBeenLastCalledWith([1, 3], { id: 'D1', name: 'Reading' });
	});

	it('General is the first deck and the default', async () => {
		const { onadd } = mount();
		const select = screen.getByRole('combobox', { name: 'Deck' }) as HTMLSelectElement;
		expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['General', 'Reading']);
		await fireEvent.click(screen.getByRole('button', { name: 'Add all new words (2)' }));
		expect(onadd).toHaveBeenLastCalledWith([1, 3], { id: 'general', name: 'General' });
	});

	it('I know these, then Undo', async () => {
		const { onmark, undo } = mount();
		await fireEvent.click(screen.getByRole('checkbox', { name: '猫' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: '鸟' }));
		await fireEvent.click(screen.getByRole('button', { name: 'I know these (2)' }));
		expect(onmark).toHaveBeenCalledWith([1, 3]);
		await screen.findByText('Marked 2 words as known');
		await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
		expect(undo).toHaveBeenCalled();
		expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
	});

	it('an add error is shown', async () => {
		mount({ onadd: vi.fn(async () => Promise.reject(new Error('offline'))) });
		await fireEvent.click(screen.getByRole('button', { name: 'Add all new words (2)' }));
		await screen.findByRole('alert');
	});

	it('book count: button, progress with Cancel, then the book figure and scope', async () => {
		const r = mount();
		await fireEvent.click(screen.getByRole('button', { name: 'Count the whole book' }));
		expect(r.oncountbook).toHaveBeenCalled();
		await r.rerender({ bookProgress: { done: 12, total: 40 } });
		expect(screen.getByText('Chapter 12 of 40')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(r.oncancelbook).toHaveBeenCalled();
		expect(screen.queryByRole('radio', { name: 'Whole book' })).toBeNull();
		await r.rerender({ bookProgress: null, book: { coverage: { ...coverage, percent: 82 }, list: [item(9, '书', 9, 'new')] } });
		expect(screen.getByText('You know 82% of the words in this book')).toBeTruthy();
		await fireEvent.click(screen.getByRole('radio', { name: 'Whole book' }));
		expect(screen.getByRole('checkbox', { name: '书' })).toBeTruthy();
	});

	it('another language: no counts', () => {
		mount({ lang: 'ko' });
		expect(screen.getByText('Word counts are available for Chinese and Japanese books')).toBeTruthy();
		expect(screen.queryByRole('checkbox')).toBeNull();
	});

	it('pages the list by 50', async () => {
		const many = Array.from({ length: 60 }, (_, i) => item(100 + i, `w${i}`, 1, 'new'));
		mount({ chapter: { coverage, list: many } });
		expect(screen.getAllByRole('listitem')).toHaveLength(50);
		await fireEvent.click(screen.getByRole('button', { name: 'Show 50 more' }));
		expect(screen.getAllByRole('listitem')).toHaveLength(60);
	});
});

describe('WordsPanel across a chapter or book change', () => {
	it('drops the selection, the result and its Undo, and the paging', async () => {
		const many = Array.from({ length: 60 }, (_, i) => item(100 + i, `w${i}`, 1, 'new'));
		const r = mount({ chapter: { coverage, list: [...list, ...many] } });
		await fireEvent.click(screen.getByRole('checkbox', { name: '猫' }));
		await fireEvent.click(screen.getByRole('button', { name: 'I know these (1)' }));
		await screen.findByRole('button', { name: 'Undo' });
		await fireEvent.click(screen.getByRole('checkbox', { name: '狗' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Show 50 more' }));
		expect(screen.getAllByRole('listitem')).toHaveLength(63);
		// Another book (and workspace) opens in the same page.
		await r.rerender({ resetKey: '2:0:original:8', chapter: { coverage, list: [...list, ...many] } });
		expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
		expect(screen.queryByText('Marked 1 word as known')).toBeNull();
		expect((screen.getByRole('checkbox', { name: '狗' }) as HTMLInputElement).checked).toBe(false);
		expect(screen.getByRole('button', { name: 'Add selected (0)' })).toBeTruthy();
		expect(screen.getAllByRole('listitem')).toHaveLength(50);
	});

	it('acts only on selected words still in the list', async () => {
		const r = mount();
		await fireEvent.click(screen.getByRole('checkbox', { name: '猫' }));
		await fireEvent.click(screen.getByRole('checkbox', { name: '狗' }));
		// 猫 became known elsewhere (the popup): it leaves the list, same chapter.
		await r.rerender({ chapter: { coverage, list: list.filter((w) => w.entryId !== 1) } });
		await fireEvent.click(screen.getByRole('button', { name: 'Add selected (1)' }));
		expect(r.onadd).toHaveBeenLastCalledWith([2], { id: 'general', name: 'General' });
	});
});

describe('WordsPanel before the cards are loaded', () => {
	it('shows no figure and offers no action while loading', () => {
		mount({ cards: 'loading' });
		expect(screen.getByText('Loading your cards…')).toBeTruthy();
		expect(screen.queryByText(/You know/)).toBeNull();
		expect(screen.queryByRole('button', { name: /Add all new words/ })).toBeNull();
		expect(screen.queryByRole('checkbox')).toBeNull();
	});

	it('a failed load says so and retries', async () => {
		const oncardsretry = vi.fn();
		mount({ cards: 'error', oncardsretry });
		expect(screen.getByText(/Could not load your cards/)).toBeTruthy();
		expect(screen.queryByText(/You know/)).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		expect(oncardsretry).toHaveBeenCalled();
	});
});

describe('WordsPanel in the lighter style (#102)', () => {
	it('the coverage figure is a Stat with its label first', () => {
		const { container } = mount();
		const stat = container.querySelector('.stat')!;
		expect(stat).toBeTruthy();
		const parts = [...stat.children].map((el) => el.className.split(' ')[0]);
		expect(parts.slice(0, 2)).toEqual(['label', 'value']);
		expect(stat.querySelector('.label')?.textContent).toBe('You know 70% of the words in this chapter');
		expect(stat.querySelector('.value')?.textContent).toBe('70%');
		// The 3px accent bar under it shows the share (decoration: the text says it).
		const bar = container.querySelector('.coverage-bar') as HTMLElement;
		expect(bar.getAttribute('aria-hidden')).toBe('true');
		expect((bar.firstElementChild as HTMLElement).style.width).toBe('70%');
	});

	it('the state of each word uses the shared w-new / w-learning marks with its words', () => {
		const { container } = mount();
		const items = container.querySelectorAll('.words li');
		expect(items[0].querySelector('.w-new')).toBeTruthy();
		expect(items[1].querySelector('.w-learning')).toBeTruthy();
	});
});
