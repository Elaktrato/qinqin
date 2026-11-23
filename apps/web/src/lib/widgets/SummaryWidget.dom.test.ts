import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/study/history', () => ({ loadStudyHistory: vi.fn() }));
vi.mock('$lib/stats/summary', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/stats/summary')>()),
	summaryNumbers: vi.fn()
}));
vi.mock('$lib/study/currentContext', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/currentContext')>()),
	onContextStale: vi.fn(() => () => {})
}));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	onStudyWrite: vi.fn(() => () => {})
}));
vi.mock('$lib/events', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/events')>()),
	onEventLogChange: vi.fn(() => () => {})
}));

import { onEventLogChange } from '$lib/events';
import { loadStudyHistory } from '$lib/study/history';
import { summaryNumbers, type SummaryNumbers } from '$lib/stats/summary';
import { onContextStale } from '$lib/study/currentContext';
import { onStudyWrite } from '$lib/study/store';
import { pluginStates } from '$lib/plugins/states';
import { workspaces } from '$lib/workspaces';
import SummaryWidget from './SummaryWidget.svelte';

const NUMBERS: SummaryNumbers = {
	streak: 23,
	wordsKnown: 1284,
	recall: { share: 0.91, base: 20 },
	studiedSeconds: 51600
};

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((res) => (resolve = res));
	return { promise, resolve };
}

function select(id: number | null): void {
	workspaces.set({
		list: [],
		current: id === null ? null : ({ id, language: 'zh', name: `w${id}` } as never)
	});
}

function flashcards(enabled: boolean): void {
	pluginStates.set({
		list: [{ id: 'qinqin-flashcards', manifest: {}, enabled, order: 0 }],
		status: 'ready'
	});
}

beforeEach(() => {
	select(1);
	flashcards(true);
	vi.mocked(loadStudyHistory).mockResolvedValue({ decks: [], cards: [], reviews: [], merged: 0 });
	vi.mocked(summaryNumbers).mockReturnValue(NUMBERS);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	select(null);
	pluginStates.set({ list: [], status: 'idle' });
});

describe('SummaryWidget', () => {
	it('shows four Stats with their labels and formatted values', async () => {
		render(SummaryWidget);

		expect(await screen.findByText('Day streak')).toBeTruthy();
		expect(screen.getByText('23')).toBeTruthy();
		expect(screen.getByText('Words known')).toBeTruthy();
		expect(screen.getByText('1,284')).toBeTruthy();
		expect(screen.getByText('Recall, last 30 days')).toBeTruthy();
		expect(screen.getByText('91%')).toBeTruthy();
		expect(screen.getByText('Studied this month')).toBeTruthy();
		expect(screen.getByText('14 h 20 min')).toBeTruthy();
		expect(loadStudyHistory).toHaveBeenCalledWith(1, { force: false });
	});

	it('recall below the floor shows the later text, not a number', async () => {
		vi.mocked(summaryNumbers).mockReturnValue({ ...NUMBERS, recall: { share: null, base: 9 } });
		render(SummaryWidget);

		expect(await screen.findByText('Shown after 10 repeat reviews')).toBeTruthy();
		expect(screen.queryByText('91%')).toBeNull();
	});

	it('flashcards switched off shows the note and no numbers', async () => {
		flashcards(false);
		render(SummaryWidget);

		expect(
			await screen.findByText('Switch on flashcards in Settings → Features to see these numbers.')
		).toBeTruthy();
		expect(screen.queryByText('Day streak')).toBeNull();
		expect(loadStudyHistory).not.toHaveBeenCalled();
	});

	it('no workspace and loading come from WidgetCard', async () => {
		select(null);
		render(SummaryWidget);
		expect(await screen.findByText('Choose a workspace in the header.')).toBeTruthy();
		expect(loadStudyHistory).not.toHaveBeenCalled();

		cleanup();
		select(1);
		vi.mocked(loadStudyHistory).mockReturnValue(deferred<never>().promise);
		render(SummaryWidget);
		expect(await screen.findByText('Loading…')).toBeTruthy();
	});

	it('the error comes from WidgetCard with Try again, which forces a reload', async () => {
		vi.mocked(loadStudyHistory).mockRejectedValueOnce(new Error('broken'));
		render(SummaryWidget);

		const retry = await screen.findByRole('button', { name: 'Try again' });
		await waitFor(() => expect(screen.getByText('Could not load your summary.')).toBeTruthy());
		retry.click();
		await waitFor(() => expect(screen.getByText('Day streak')).toBeTruthy());
		expect(vi.mocked(loadStudyHistory).mock.calls.at(-1)?.[1]).toEqual({ force: true });
	});

	it('reloads on onStudyWrite for this workspace', async () => {
		render(SummaryWidget);
		await waitFor(() => expect(loadStudyHistory).toHaveBeenCalledTimes(1));
		const onWrite = vi.mocked(onStudyWrite).mock.calls.at(-1)![0];

		onWrite(2);
		await tick();
		expect(loadStudyHistory).toHaveBeenCalledTimes(1);
		onWrite(1);
		await waitFor(() => expect(loadStudyHistory).toHaveBeenCalledTimes(2));
	});

	it('reloads on a posted review for this workspace', async () => {
		render(SummaryWidget);
		await waitFor(() => expect(loadStudyHistory).toHaveBeenCalledTimes(1));
		const onLog = vi.mocked(onEventLogChange).mock.calls.at(-1)![0];

		onLog(2);
		await tick();
		expect(loadStudyHistory).toHaveBeenCalledTimes(1);
		onLog(1);
		await waitFor(() => expect(loadStudyHistory).toHaveBeenCalledTimes(2));
	});

	it('a slow earlier load never overwrites a newer one', async () => {
		const first = deferred<never>();
		const second = deferred<never>();
		vi.mocked(loadStudyHistory).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		render(SummaryWidget);
		await tick();
		select(2);
		await tick();
		vi.mocked(summaryNumbers).mockReturnValue({ ...NUMBERS, streak: 30 });
		second.resolve({
			decks: [],
			cards: [],
			reviews: [],
			merged: 0
		} as never);
		await waitFor(() => expect(screen.getByText('30')).toBeTruthy());
		first.resolve({ decks: [], cards: [], reviews: [], merged: 0 } as never);
		await tick();
		await Promise.resolve();
		expect(screen.getByText('30')).toBeTruthy();
	});

	it('reloads when the learner day changes', async () => {
		render(SummaryWidget);
		await waitFor(() => expect(loadStudyHistory).toHaveBeenCalledTimes(1));
		vi.mocked(onContextStale).mock.calls[0][0]();
		await waitFor(() => expect(loadStudyHistory).toHaveBeenCalledTimes(2));
	});
});
