// The mistake notebook (#227) in the DOM: the groups from the history's wrong answers, the marks (Remove, Clear)
// written through the session's outbox, the due cards' flashcards session, and the round of its drill items (the
// sample drill behind the developer flag).
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyHistory: vi.fn()
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));

import { goto } from '$app/navigation';
import type { StudyEventBody } from '$lib/api/types';
import type { StudyEvent } from '$lib/events';
import { DEV_DRILLS_KEY } from '$lib/features/practice/drills';
import { SESSION_CONFIG_KEY } from '$lib/features/flashcards/session/session';
import { loadStudyHistory } from '$lib/studycore/data';
import { historyOf } from '$lib/studycore/readModel';
import type { StudyCard } from '$lib/studycore/types';
import NotebookPage from './NotebookPage.svelte';

const NOW = Date.parse('2026-11-28T12:00:00Z');
let ctx: TestContext = testContext();
let recorded: StudyEventBody[] = [];

const card: StudyCard = { id: 'c-vocab-1', kind: 'vocab', entryId: 1, written: '学习', deckIds: ['general'], createdAt: '2026-11-01T00:00:00Z' };

function ev(n: number, type: string, payload: unknown, daysAgo: number): StudyEvent {
	return { id: `01KB0000000000000000000${String(n).padStart(3, '0')}`, workspaceId: 1, device: 'web', ts: new Date(NOW - daysAgo * 86_400_000).toISOString(), type, payload };
}

const wrongCard = ev(1, 'review', { cardId: 'c-vocab-1', mode: 'vocab', grade: 1 }, 3);
const wrongDrill = ev(2, 'drill.sample', { item: 'sample-2', mode: 'self', grade: 1 }, 2);

function useHistory(events: StudyEvent[]): void {
	vi.mocked(loadStudyHistory).mockResolvedValue(historyOf(1, { decks: [], cards: [card] }, events));
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	ctx = testContext({ routes: { 'GET /api/drills/counters': { counters: [] }, 'POST /api/drills/measure-words/words': { words: [], pools: {} } } });
	recorded = [];
	localStorage.setItem(DEV_DRILLS_KEY, 'sample');
	sessionStorage.clear();
	ctx.session.workspaces.set({ list: [], current: { id: 1, language: 'ko', name: 'ko' } as never });
	useHistory([wrongCard, wrongDrill]);
	vi.spyOn(ctx.session.outbox, 'recordEvent').mockImplementation(async (event) => {
		recorded.push(event);
		return event;
	});
});

afterEach(() => {
	cleanup();
	localStorage.removeItem(DEV_DRILLS_KEY);
	vi.restoreAllMocks();
	vi.mocked(goto).mockClear();
	vi.useRealTimers();
});

const show = (rest = '') => render(NotebookPage, { props: { rest }, context: ctx.context });

describe('the mistake notebook', () => {
	it('lists the wrong answers by group, newest first, with what went wrong and a link', async () => {
		show();
		expect(screen.getByRole('heading', { level: 1, name: 'Mistake notebook' })).toBeTruthy();
		const words = await screen.findByRole('region', { name: 'Words' });
		const items = within(words).getAllByRole('listitem');
		// The drill item (two days ago) before the card (three days ago).
		expect(items[0].textContent).toContain('sample-2');
		expect(items[0].textContent).toContain('Answered wrong');
		expect(items[1].textContent).toContain('学习');
		expect(items[1].textContent).toContain('Card: Recognise');
		expect(items[1].textContent).toContain('Answered Again');
		expect(within(items[1]).getByRole('link', { name: 'Open the word' }).getAttribute('href')).toBe('/entry/1');
		expect(within(items[0]).getByRole('link', { name: 'Practise' }).getAttribute('href')).toBe('/practice/sample');
	});

	it('says so when there is nothing to go over', async () => {
		useHistory([]);
		show();
		expect(await screen.findByText(/No mistakes to go over/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Clear the notebook' })).toBeNull();
	});

	it('Remove writes a removal mark through the outbox and loads the notebook again', async () => {
		show();
		await fireEvent.click(await screen.findByRole('button', { name: 'Remove 学习 from the notebook' }));
		await waitFor(() => expect(recorded).toHaveLength(1));
		expect(recorded[0]).toMatchObject({ workspaceId: 1, type: 'notebook', payload: { action: 'remove', item: 'card:c-vocab-1' } });
		expect(JSON.stringify(recorded[0].payload)).toBe('{"action":"remove","item":"card:c-vocab-1"}');
		expect(await screen.findByText('Removed 学习 from the notebook.')).toBeTruthy();
		await waitFor(() => expect(vi.mocked(loadStudyHistory).mock.calls.length).toBeGreaterThan(1));
	});

	it('Clear asks first, then writes a clear mark', async () => {
		show();
		await fireEvent.click(await screen.findByRole('button', { name: 'Clear the notebook' }));
		const dialog = await screen.findByRole('dialog', { name: 'Clear the mistake notebook?' });
		await fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
		await waitFor(() => expect(recorded).toHaveLength(1));
		expect(JSON.stringify(recorded[0].payload)).toBe('{"action":"clear"}');
	});

	it('offers the round of its drill items and a session of its due cards, limited to them', async () => {
		show();
		expect((await screen.findByRole('link', { name: 'Practise my mistakes' })).getAttribute('href')).toBe('/notebook/practise');
		expect(screen.getByText('1 drill item to practise.')).toBeTruthy();
		expect(screen.getByText('1 card is due now.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Review the due cards' }));
		const saved = JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY) ?? 'null');
		expect(saved).toMatchObject({ mode: 'decks', deckIds: ['general'], cardIds: ['c-vocab-1'], studyAll: true, from: '/notebook' });
		expect(goto).toHaveBeenCalledWith('/study/session');
	});

	it('the round asks the drill items and records each answer as the drill\'s event', async () => {
		show('practise');
		expect(screen.getByRole('heading', { level: 1, name: 'Practise my mistakes' })).toBeTruthy();
		expect(await screen.findByText('sample-2')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'I knew it' }));
		await waitFor(() => expect(recorded).toHaveLength(1));
		expect(recorded[0]).toMatchObject({ type: 'drill.sample', payload: { item: 'sample-2', grade: 3 } });
	});
});
