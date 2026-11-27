import { EventLog } from '$lib/events';
import type { MockInstance } from 'vitest';
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyHistory: vi.fn(),
	onStudyChange: vi.fn(() => () => {})
}));
vi.mock('$lib/stats/summary', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/stats/summary')>()),
	summaryNumbers: vi.fn()
}));
vi.mock('$lib/studycore/currentContext', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/currentContext')>()),
	onContextStale: vi.fn(() => () => {})
}));

import { summaryNumbers, type SummaryNumbers } from '$lib/stats/summary';
import { onContextStale } from '$lib/studycore/currentContext';
import { onStudyChange, loadStudyHistory } from '$lib/studycore/data';
import SummaryWidget from './SummaryWidget.svelte';

// The session's event log (record 0009): its methods, faked on the class.
let onEventLogChange!: MockInstance<EventLog['onChange']>;
beforeEach(() => {
	onEventLogChange = vi.spyOn(EventLog.prototype, 'onChange').mockImplementation((() => () => {}) as never);
});

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

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
	ctx.session.workspaces.set({
		list: [],
		current: id === null ? null : ({ id, language: 'zh', name: `w${id}` } as never)
	});
}

function flashcards(enabled: boolean): void {
	ctx.session.features.set({
		list: [{ id: 'flashcards', enabled }],
		status: 'ready'
	});
}

beforeEach(() => {
	select(1);
	flashcards(true);
	vi.mocked(loadStudyHistory).mockResolvedValue({ decks: [], cards: [], reviews: [], merged: 0, grammarRuns: [] });
	vi.mocked(summaryNumbers).mockReturnValue(NUMBERS);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	select(null);
	ctx.session.features.set({ list: [], status: 'idle' });
});

describe('SummaryWidget', () => {
	it('shows four Stats with their labels and formatted values', async () => {
		render(SummaryWidget, { context: ctx.context });

		expect(await screen.findByText('Day streak')).toBeTruthy();
		expect(screen.getByText('23')).toBeTruthy();
		expect(screen.getByText('Words known')).toBeTruthy();
		expect(screen.getByText('1,284')).toBeTruthy();
		expect(screen.getByText('Recall, last 30 days')).toBeTruthy();
		expect(screen.getByText('91%')).toBeTruthy();
		expect(screen.getByText('Studied this month')).toBeTruthy();
		expect(screen.getByText('14 h 20 min')).toBeTruthy();
		expect(loadStudyHistory).toHaveBeenCalledWith(expect.anything(), 1, { force: false });
	});

	it('recall below the floor shows the later text, not a number', async () => {
		vi.mocked(summaryNumbers).mockReturnValue({ ...NUMBERS, recall: { share: null, base: 9 } });
		render(SummaryWidget, { context: ctx.context });

		expect(await screen.findByText('Shown after 10 repeat reviews')).toBeTruthy();
		expect(screen.queryByText('91%')).toBeNull();
	});

	it('flashcards switched off shows the note and no numbers', async () => {
		flashcards(false);
		render(SummaryWidget, { context: ctx.context });

		expect(
			await screen.findByText('Switch on flashcards in Settings → Features to see these numbers.')
		).toBeTruthy();
		expect(screen.queryByText('Day streak')).toBeNull();
		expect(loadStudyHistory).not.toHaveBeenCalled();
	});

	it('no workspace and loading come from WidgetCard', async () => {
		select(null);
		render(SummaryWidget, { context: ctx.context });
		expect(await screen.findByText('Choose a workspace in the header.')).toBeTruthy();
		expect(loadStudyHistory).not.toHaveBeenCalled();

		cleanup();
		select(1);
		vi.mocked(loadStudyHistory).mockReturnValue(deferred<never>().promise);
		render(SummaryWidget, { context: ctx.context });
		expect(await screen.findByText('Loading…')).toBeTruthy();
	});

	it('the error comes from WidgetCard with Try again, which forces a reload', async () => {
		vi.mocked(loadStudyHistory).mockRejectedValueOnce(new Error('broken'));
		render(SummaryWidget, { context: ctx.context });

		const retry = await screen.findByRole('button', { name: 'Try again' });
		await waitFor(() => expect(screen.getByText('Could not load your summary.')).toBeTruthy());
		retry.click();
		await waitFor(() => expect(screen.getByText('Day streak')).toBeTruthy());
		expect(vi.mocked(loadStudyHistory).mock.calls.at(-1)?.[2]).toEqual({ force: true });
	});

	it('reloads on onStudyChange for this workspace', async () => {
		render(SummaryWidget, { context: ctx.context });
		await waitFor(() => expect(loadStudyHistory).toHaveBeenCalledTimes(1));
		const onWrite = vi.mocked(onStudyChange).mock.calls.at(-1)![1];

		onWrite(2);
		await tick();
		expect(loadStudyHistory).toHaveBeenCalledTimes(1);
		onWrite(1);
		await waitFor(() => expect(loadStudyHistory).toHaveBeenCalledTimes(2));
	});

	it('reloads on a posted review for this workspace', async () => {
		render(SummaryWidget, { context: ctx.context });
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
		render(SummaryWidget, { context: ctx.context });
		await tick();
		select(2);
		await tick();
		vi.mocked(summaryNumbers).mockReturnValue({ ...NUMBERS, streak: 30 });
		second.resolve({
			decks: [],
			cards: [],
			reviews: [],
			merged: 0, grammarRuns: []
		} as never);
		await waitFor(() => expect(screen.getByText('30')).toBeTruthy());
		first.resolve({ decks: [], cards: [], reviews: [], merged: 0, grammarRuns: [] } as never);
		await tick();
		await Promise.resolve();
		expect(screen.getByText('30')).toBeTruthy();
	});

	it('reloads when the learner day changes', async () => {
		render(SummaryWidget, { context: ctx.context });
		await waitFor(() => expect(loadStudyHistory).toHaveBeenCalledTimes(1));
		vi.mocked(onContextStale).mock.calls[0][1]();
		await waitFor(() => expect(loadStudyHistory).toHaveBeenCalledTimes(2));
	});
});
