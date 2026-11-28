// The Practice area end to end in the DOM, with the sample drill behind the developer flag: the list, a round whose
// answers go through the session's outbox as drill.sample events, the result, and the weakest round from the
// answers in the history (docs/contracts/drills/).
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyHistory: vi.fn()
}));

import type { StudyEventBody } from '$lib/api/types';
import { loadStudyHistory } from '$lib/studycore/data';
import { drillAnswersOf } from '$lib/studycore/drills';
import type { StudyEvent } from '$lib/events';
import { DEV_DRILLS_KEY } from './drills';
import PracticePage from './PracticePage.svelte';

// A fixed clock: the answers are dated before it, the picks run at it.
const NOW = Date.parse('2026-11-28T12:00:00Z');
let ctx: TestContext = testContext();
let recorded: StudyEventBody[] = [];

function answer(n: number, item: string, grade: number, minutesAgo: number): StudyEvent {
	return {
		id: `01KB0000000000000000000${String(n).padStart(3, '0')}`,
		workspaceId: 1,
		device: 'web',
		ts: new Date(NOW - minutesAgo * 60_000).toISOString(),
		type: 'drill.sample',
		payload: { item, mode: 'self', grade }
	};
}

function history(events: StudyEvent[] = []) {
	return { decks: [], cards: [], reviews: [], merged: 0, grammarRuns: [], drillAnswers: drillAnswersOf(1, events) };
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	ctx = testContext();
	recorded = [];
	localStorage.setItem(DEV_DRILLS_KEY, 'sample');
	ctx.session.workspaces.set({ list: [], current: { id: 1, language: 'ja', name: 'ja' } as never });
	vi.mocked(loadStudyHistory).mockResolvedValue(history());
	vi.spyOn(ctx.session.outbox, 'recordEvent').mockImplementation(async (event) => {
		recorded.push(event);
		return event;
	});
});

afterEach(() => {
	cleanup();
	localStorage.removeItem(DEV_DRILLS_KEY);
	vi.restoreAllMocks();
	vi.useRealTimers();
});

const show = (rest: string) => render(PracticePage, { props: { rest }, context: ctx.context });

describe('the Practice list', () => {
	it('lists the sample drill with its counts; nothing is weak before an answer', async () => {
		show('');
		expect(await screen.findByRole('heading', { level: 2, name: 'Sample drill' })).toBeTruthy();
		expect(screen.getByText('5 new')).toBeTruthy();
		expect(screen.getByText('0 due')).toBeTruthy();
		expect(screen.getByText(/Answer a few questions first/)).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Practise' }).getAttribute('href')).toBe('/practice/sample');
		expect(screen.queryByRole('link', { name: 'Practise weakest' })).toBeNull();
	});

	it('says so when no drill applies (no developer flag, no registered drill of the language)', async () => {
		localStorage.removeItem(DEV_DRILLS_KEY);
		ctx.session.workspaces.set({ list: [], current: { id: 1, language: 'ko', name: 'ko' } as never });
		show('');
		expect(await screen.findByText('No drills for this language yet.')).toBeTruthy();
	});

	it('offers the weakest round once an item has an answer', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history([answer(1, 'sample-2', 1, 30), answer(2, 'sample-1', 3, 1)]));
		show('');
		expect(await screen.findByText('Your 2 weakest items, from every drill.')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Practise weakest' }).getAttribute('href')).toBe('/practice/weakest');
		expect(screen.getByText('3 new')).toBeTruthy();
		expect(screen.getByText('2 practised')).toBeTruthy();
	});

	it('shows the load error', async () => {
		vi.mocked(loadStudyHistory).mockRejectedValue(new Error('offline'));
		show('');
		expect((await screen.findByRole('alert')).textContent).toContain('Could not load your practice');
	});
});

describe('a round', () => {
	it('asks each item, records each answer as a drill event, and ends with the result', async () => {
		show('sample');
		expect(await screen.findByText('Question 1 of 5')).toBeTruthy();
		expect(screen.getByText('sample-1')).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'I knew it' }));
		await waitFor(() => expect(recorded).toHaveLength(1));
		expect(recorded[0]).toMatchObject({ workspaceId: 1, type: 'drill.sample', payload: { item: 'sample-1', mode: 'self', grade: 3 } });
		const next = screen.getByRole('button', { name: 'Next' });
		// The answer buttons went away: the focus goes to Next.
		await waitFor(() => expect(document.activeElement).toBe(next));

		for (const [i, choice] of ['I did not', 'I knew it', 'I knew it', 'I knew it'].entries()) {
			await fireEvent.click(screen.getByRole('button', { name: /Next|See results/ }));
			expect(screen.getByText(`Question ${i + 2} of 5`)).toBeTruthy();
			await fireEvent.click(screen.getByRole('button', { name: choice }));
		}
		await waitFor(() => expect(recorded).toHaveLength(5));
		expect(recorded.map((e) => (e.payload as { item: string }).item)).toEqual(['sample-1', 'sample-2', 'sample-3', 'sample-4', 'sample-5']);
		expect(recorded[1].payload).toMatchObject({ grade: 1 });

		await fireEvent.click(screen.getByRole('button', { name: 'See results' }));
		expect(screen.getByRole('heading', { name: 'Round done' })).toBeTruthy();
		expect(screen.getByText('4 of 5 right')).toBeTruthy();
		expect(screen.getByRole('listitem').textContent).toBe('sample-2');
		expect(screen.getByRole('link', { name: 'Back to the drills' }).getAttribute('href')).toBe('/practice');

		// Practise again: a fresh round from the history as it is now.
		vi.mocked(loadStudyHistory).mockResolvedValue(history(recorded as StudyEvent[]));
		await fireEvent.click(screen.getByRole('button', { name: 'Practise again' }));
		expect(await screen.findByText('Question 1 of 5')).toBeTruthy();
		// sample-2 was wrong: it is due a minute later, so it is not first yet; the round still has every item.
		expect(screen.getByText(/^sample-/)).toBeTruthy();
	});

	it('the weakest round asks the weakest item first', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(history([answer(1, 'sample-4', 4, 60), answer(2, 'sample-3', 1, 60)]));
		show('weakest');
		expect(await screen.findByText('Question 1 of 2')).toBeTruthy();
		expect(screen.getByRole('heading', { level: 1, name: 'Weakest items' })).toBeTruthy();
		expect(screen.getByText('sample-3')).toBeTruthy();
	});

	it('says when an answer was not saved', async () => {
		vi.mocked(ctx.session.outbox.recordEvent).mockResolvedValue(null);
		show('sample');
		await fireEvent.click(await screen.findByRole('button', { name: 'I knew it' }));
		expect((await screen.findByRole('alert')).textContent).toContain('Some answers were not saved');
	});

	it('a drill that does not apply is the list', async () => {
		show('tone-pairs');
		expect(await screen.findByRole('heading', { level: 2, name: 'Sample drill' })).toBeTruthy();
		expect(screen.getByRole('heading', { level: 1, name: 'Practice' })).toBeTruthy();
	});
});
