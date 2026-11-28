import { testContext, updateWorkspaces, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import popupFixture from '../../../../../../docs/contracts/reader/popup-written.json';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import type { LookupResult, Workspace } from '$lib/api/types';

vi.mock('$lib/api/entries', () => ({ addSentence: vi.fn(), getEntry: vi.fn() }));
vi.mock('$lib/features/flashcards/commands/cards', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/flashcards/commands/cards')>()),
	addCard: vi.fn(async () => ({}))
}));
vi.mock('$lib/studycore/commands/keyed', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/commands/keyed')>()),
	setKnownMark: vi.fn(async () => {})
}));
vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	getStudyData: vi.fn(async () => ({ decks: [], cards: [] })),
	hasCard: vi.fn(() => false)
}));


import { LookupRecorder } from '$lib/lookups/recorder';
import { addSentence, getEntry } from '$lib/api/entries';
import { addCard } from '$lib/features/flashcards/commands/cards';
import { setKnownMark } from '$lib/studycore/commands/keyed';
import { getStudyData, hasCard } from '$lib/studycore/data';
import AddToStudyButtons from './AddToStudyButtons.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

function result(kind: 'word' | 'character'): LookupResult {
	return {
		entryId: 11,
		kind,
		term: '学',
		reading: '',
		forms: [],
		readings: [],
		matched: '学',
		start: 0,
		end: 1,
		reasons: [],
		tags: [],
		frequencies: [],
		levels: [],
		senses: [],
		pri: 0
	} as unknown as LookupResult;
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('AddToStudyButtons', () => {
	it('snapshots entryKind for a character result', async () => {
		render(AddToStudyButtons, { props: {
			result: result('character'),
			workspaceId: 1,
			paragraph: null,
			hold: vi.fn()
		}, context: ctx.context });
		const plus = await screen.findByRole('button', { name: 'Add to deck: 学' });
		await waitFor(() => expect((plus as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(plus);
		await waitFor(() => expect(addCard).toHaveBeenCalled());
		const [, ws, , opts] = vi.mocked(addCard).mock.calls[0] as unknown as [unknown, number, number, Record<string, unknown>];
		expect(ws).toBe(1);
		expect(opts.entryKind).toBe('character');
		expect(opts.sentenceId).toBeUndefined();
	});

	it('leaves word cards without it', async () => {
		render(AddToStudyButtons, { props: {
			result: result('word'),
			workspaceId: 1,
			paragraph: null,
			hold: vi.fn()
		}, context: ctx.context });
		const plus = await screen.findByRole('button', { name: 'Add to deck: 学' });
		await waitFor(() => expect((plus as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(plus);
		await waitFor(() => expect(addCard).toHaveBeenCalled());
		const [, ws, , opts] = vi.mocked(addCard).mock.calls[0] as unknown as [unknown, number, number, Record<string, unknown>];
		expect(ws).toBe(1);
		expect(opts.entryKind).toBeUndefined();
	});
});

describe('I know this', () => {
	const mount = (over: Record<string, unknown> = {}) =>
		render(AddToStudyButtons, { props: { result: result('word'), workspaceId: 3, paragraph: null, hold: vi.fn(), ...over } as never, context: ctx.context });
	const toggle = async () => {
		const b = (await screen.findByRole('button', { name: 'I know this' })) as HTMLButtonElement;
		await waitFor(() => expect(b.disabled).toBe(false));
		return b;
	};

	it('starts pressed when the word is marked', async () => {
		vi.mocked(getStudyData).mockResolvedValueOnce({ decks: [], cards: [], known: [11] });
		mount();
		const b = await toggle();
		await waitFor(() => expect(b.getAttribute('aria-pressed')).toBe('true'));
	});

	it('marks in the book workspace, a second click unmarks', async () => {
		mount();
		const b = await toggle();
		expect(b.getAttribute('aria-pressed')).toBe('false');
		await fireEvent.click(b);
		await waitFor(() => expect(setKnownMark).toHaveBeenLastCalledWith(expect.anything(), 3, 11, true));
		await waitFor(() => expect(b.getAttribute('aria-pressed')).toBe('true'));
		await fireEvent.click(b);
		await waitFor(() => expect(setKnownMark).toHaveBeenLastCalledWith(expect.anything(), 3, 11, false));
		await waitFor(() => expect(b.getAttribute('aria-pressed')).toBe('false'));
	});

	it('a failed write restores the state and says so', async () => {
		vi.mocked(setKnownMark).mockRejectedValueOnce(new Error('offline'));
		mount();
		const b = await toggle();
		await fireEvent.click(b);
		await screen.findByText('Could not save this mark.');
		expect(b.getAttribute('aria-pressed')).toBe('false');
	});

	it('shows the state line only when given', async () => {
		mount({ stateLine: 'Known — memory score 85' });
		expect(await screen.findByText('Known — memory score 85')).toBeTruthy();
		cleanup();
		mount();
		await toggle();
		expect(screen.queryByText(/memory score|New word|Learning/)).toBeNull();
	});
});

describe("You've looked this up N times (#72)", () => {
	const T = '2026-11-15T09:00:00Z';
	async function recorder(count: number, record = true): Promise<void> {
		const r = new LookupRecorder({
			readRow: async () => ({ version: 1, clearedAt: null, items: [{ entryId: 11, count, firstAt: T, lastAt: T, sources: {}, books: [] }] }),
			writeRow: async () => {},
			readCfg: async () => ({ version: 1, record })
		});
		await r.load(3);
		// The session's recorder (record 0009).
		Object.defineProperty(ctx.session.lookups, 'recorder', { value: r });
	}
	const mount = (over: Record<string, unknown> = {}) =>
		render(AddToStudyButtons, { props: { result: result('word'), workspaceId: 3, paragraph: 'p', first: true, hold: vi.fn(), ...over } as never, context: ctx.context });
	const settled = async () => {
		const b = (await screen.findByRole('button', { name: 'I know this' })) as HTMLButtonElement;
		await waitFor(() => expect(b.disabled).toBe(false));
	};
	const HINT = /looked this up/;

	it('three lookups, no card, not marked, first result of the root popup: the hint', async () => {
		await recorder(3);
		mount();
		expect(await screen.findByText("You've looked this up 3 times.")).toBeTruthy();
	});

	it('two lookups: no hint', async () => {
		await recorder(2);
		mount();
		await settled();
		expect(screen.queryByText(HINT)).toBeNull();
	});

	it('a word with a card: no hint', async () => {
		await recorder(5);
		vi.mocked(hasCard).mockReturnValueOnce(true);
		mount();
		await screen.findByText('In study');
		expect(screen.queryByText(HINT)).toBeNull();
	});

	it('marked known: no hint', async () => {
		await recorder(5);
		vi.mocked(getStudyData).mockResolvedValueOnce({ decks: [], cards: [], known: [11] });
		mount();
		await settled();
		expect(screen.queryByText(HINT)).toBeNull();
	});

	it('a nested popup or a later result: no hint', async () => {
		await recorder(5);
		mount({ paragraph: null });
		await settled();
		expect(screen.queryByText(HINT)).toBeNull();
		cleanup();
		mount({ first: false });
		await settled();
		expect(screen.queryByText(HINT)).toBeNull();
	});

	it('recording off: no hint', async () => {
		await recorder(5, false);
		mount();
		await settled();
		expect(screen.queryByText(HINT)).toBeNull();
	});
});

describe('the lighter popup actions (#102)', () => {
	const mount = (over: Record<string, unknown> = {}) =>
		render(AddToStudyButtons, { props: { result: result('word'), workspaceId: 3, paragraph: null, hold: vi.fn(), ...over } as never, context: ctx.context });
	const ready = async (name: string | RegExp) => {
		const b = (await screen.findByRole('button', { name })) as HTMLButtonElement;
		await waitFor(() => expect(b.disabled).toBe(false));
		return b;
	};

	it('"Add to deck" is the primary button and adds to General in one click (as before)', async () => {
		mount();
		const add = await ready('Add to deck: 学');
		expect(add.textContent).toContain('Add to deck');
		expect(add.classList.contains('primary')).toBe(true);
		await fireEvent.click(add);
		await waitFor(() => expect(addCard).toHaveBeenCalled());
		const [, ws, , opts] = vi.mocked(addCard).mock.calls[0] as unknown as [unknown, number, number, Record<string, unknown>];
		expect(opts.deckIds).toEqual(['general']);
		expect(ws, 'the book\'s workspace').toBe(3);
		expect(await screen.findByText('In study')).toBeTruthy();
	});

	it('"Choose a deck" opens a Menu of decks, Escape returns focus to it, choosing one adds there', async () => {
		vi.mocked(getStudyData).mockResolvedValue({
			decks: [{ id: 'd1', name: 'Lu Xun', createdAt: '2026-11-01T00:00:00Z' }],
			cards: []
		} as never);
		mount();
		const choose = await ready('Choose a deck');
		await fireEvent.click(choose);
		const menu = await screen.findByRole('menu');
		expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent?.trim())).toEqual(['General', 'Lu Xun']);
		await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
		await tick();
		expect(screen.queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(choose);
		await fireEvent.click(choose);
		await fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Lu Xun' }));
		await waitFor(() => expect(addCard).toHaveBeenCalled());
		const [, , , opts] = vi.mocked(addCard).mock.calls[0] as unknown as [unknown, number, number, Record<string, unknown>];
		expect(opts.deckIds).toEqual(['d1']);
		vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [] } as never);
	});

	it('"I know this" is a toggle with aria-pressed and a check icon when on', async () => {
		vi.mocked(getStudyData).mockResolvedValueOnce({ decks: [], cards: [], known: [11] } as never);
		mount();
		const b = await ready('I know this');
		await waitFor(() => expect(b.getAttribute('aria-pressed')).toBe('true'));
		expect(b.querySelector('svg')).toBeTruthy();
	});

	it('the snapshot is the display form of reader/popup-written.json (の, not 乃)', async () => {
		const c = popupFixture.cases[0];
		mount({ result: { ...result('word'), term: c.term, forms: c.forms, readings: c.readings, senses: c.senses } });
		await fireEvent.click(await ready(`Add to deck: ${c.term}`));
		await waitFor(() => expect(addCard).toHaveBeenCalled());
		const [, ws, , opts] = vi.mocked(addCard).mock.calls[0] as unknown as [unknown, number, number, Record<string, unknown>];
		expect(opts.written).toBe('の');
	});
});

describe('Save this sentence (#279)', () => {
	// 学 at offsets 2..3 of the paragraph's first sentence.
	const paragraph = '我在学中文。他也学。';
	const studied = () => {
		vi.mocked(getStudyData).mockResolvedValue({
			decks: [],
			cards: [{ id: 'v11', kind: 'vocab', entryId: 11, written: '学', deckIds: ['d1'], createdAt: '2026-11-01T00:00:00Z' }]
		});
		vi.mocked(hasCard).mockReturnValue(true);
		vi.mocked(getEntry).mockResolvedValue({ sentences: [] } as never);
		vi.mocked(addSentence).mockResolvedValue({ id: 5 } as never);
	};
	const word = (): LookupResult => ({ ...result('word'), start: 2, end: 3 });
	const withSettings = (settings: Record<string, unknown>) => {
		const ws: Workspace = { id: 3, language: 'zh', name: '', settings, updatedAt: 't' };
		updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	};
	const mount = (over: Record<string, unknown> = {}) =>
		render(AddToStudyButtons, {
			props: { result: word(), workspaceId: 3, paragraph, first: true, hold: vi.fn(), ...over } as never,
			context: ctx.context
		});

	afterEach(() => {
		vi.mocked(getStudyData).mockReset();
		vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [] });
		vi.mocked(hasCard).mockReset();
		vi.mocked(hasCard).mockReturnValue(false);
	});

	it('saves the book, chapter and the word\'s place with the sentence (#280)', async () => {
		studied();
		mount({ place: { bookId: 8, chapter: 1, paragraph: 4 } });
		await fireEvent.click(await screen.findByRole('button', { name: 'Save this sentence for 学' }));
		await screen.findByText('Sentence saved as a new card.');
		expect(addSentence).toHaveBeenCalledWith(11, '我在学中文。', { bookId: 8, chapter: 1, paragraph: 4, start: 2, end: 3 });
	});

	it('saves the book sentence of a studied word as a sentence card in its decks', async () => {
		studied();
		mount();
		const save = await screen.findByRole('button', { name: 'Save this sentence for 学' });
		await fireEvent.click(save);
		await screen.findByText('Sentence saved as a new card.');
		expect(addSentence).toHaveBeenCalledWith(11, '我在学中文。');
		expect(addCard).toHaveBeenCalledWith(expect.anything(), 3, 11, { kind: 'sentence', sentenceId: 5, deckIds: ['d1'], written: '学' });
		expect(screen.queryByRole('button', { name: 'Save this sentence for 学' })).toBeNull();
	});

	it('says so when the sentence is already saved', async () => {
		studied();
		vi.mocked(getEntry).mockResolvedValue({ sentences: [{ id: 2, hanzi: '我在学中文。' }] } as never);
		vi.mocked(getStudyData).mockResolvedValue({
			decks: [],
			cards: [
				{ id: 'v11', kind: 'vocab', entryId: 11, deckIds: ['general'], createdAt: '2026-11-01T00:00:00Z' },
				{ id: 's11', kind: 'sentence', entryId: 11, sentenceId: 2, deckIds: ['general'], createdAt: '2026-11-01T00:00:00Z' }
			]
		});
		mount();
		await fireEvent.click(await screen.findByRole('button', { name: 'Save this sentence for 学' }));
		await screen.findByText('This sentence is already saved.');
		expect(addSentence).not.toHaveBeenCalled();
		expect(addCard).not.toHaveBeenCalled();
	});

	it('a failed save says so and keeps the button', async () => {
		studied();
		vi.mocked(addSentence).mockRejectedValue(new Error('offline'));
		mount();
		await fireEvent.click(await screen.findByRole('button', { name: 'Save this sentence for 学' }));
		await screen.findByText('Could not save this sentence.');
		expect(screen.getByRole('button', { name: 'Save this sentence for 学' })).toBeTruthy();
	});

	it('is not offered without a sentence, for a character, or for a word not in study', async () => {
		studied();
		mount({ paragraph: null });
		await screen.findByText('In study');
		expect(screen.queryByRole('button', { name: /Save this sentence/ })).toBeNull();
		cleanup();
		mount({ result: { ...result('character'), start: 2, end: 3 } });
		await screen.findByText('In study');
		expect(screen.queryByRole('button', { name: /Save this sentence/ })).toBeNull();
		cleanup();
		vi.mocked(hasCard).mockReturnValue(false);
		mount();
		await screen.findByRole('button', { name: 'Add to deck: 学' });
		expect(screen.queryByRole('button', { name: /Save this sentence/ })).toBeNull();
	});

	it('the automatic mode saves on look-up when the workspace turns it on', async () => {
		studied();
		withSettings({ reader: { saveSentences: true } });
		mount();
		await screen.findByText('New sentence saved as a card.');
		expect(addSentence).toHaveBeenCalledWith(11, '我在学中文。');
		expect(addCard).toHaveBeenCalledOnce();
	});

	it('the automatic mode is off by default and never runs for a later result', async () => {
		studied();
		withSettings({});
		mount();
		await screen.findByRole('button', { name: 'Save this sentence for 学' });
		cleanup();
		withSettings({ reader: { saveSentences: true } });
		mount({ first: false });
		await screen.findByRole('button', { name: 'Save this sentence for 学' });
		await tick();
		expect(addSentence).not.toHaveBeenCalled();
		expect(getEntry).not.toHaveBeenCalled();
	});

	it('a failed automatic save shows no error', async () => {
		studied();
		vi.mocked(addSentence).mockRejectedValue(new Error('offline'));
		withSettings({ reader: { saveSentences: true } });
		mount();
		await waitFor(() => expect(addSentence).toHaveBeenCalled());
		await tick();
		expect(screen.queryByText('Could not save this sentence.')).toBeNull();
		expect(screen.getByRole('button', { name: 'Save this sentence for 学' })).toBeTruthy();
	});
});
