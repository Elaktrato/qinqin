import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/time/zone', () => ({
	currentStudyDay: vi.fn(),
	currentStudyHistory: vi.fn(() => []),
	onStudyDayChange: vi.fn(() => () => {})
}));
vi.mock('$lib/study/studyData', () => ({ getStudyData: vi.fn() }));
vi.mock('$lib/api/stats', () => ({ fetchActivity: vi.fn() }));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	saveGoals: vi.fn(() => Promise.resolve())
}));

import { fetchActivity, type ActivitySource } from '$lib/api/stats';
import { saveGoals } from '$lib/study/store';
import { getStudyData } from '$lib/study/studyData';
import type { StudyData } from '$lib/study/types';
import { studyDay } from '$lib/time/studyDay';
import { currentStudyDay } from '$lib/time/zone';
import { workspaces } from '$lib/workspaces';
import { primaryActions } from '$lib/ui/testing/primary';
import GoalSettings from './GoalSettings.svelte';

const day = studyDay([]);
const today = day.today();

const SOURCES: ActivitySource[] = [
	{ type: 'read', plugin: 'qinqin-reader', label: 'Reading', unit: 'seconds', describe: { one: '{n} minute of reading', other: '{n} minutes of reading' } },
	{ type: 'review', plugin: 'qinqin-flashcards', label: 'Flashcard reviews', unit: 'count', describe: { one: '{n} flashcard review', other: '{n} flashcard reviews' } }
];

function select(id: number): void {
	workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'zh' } as never, { id: 2, language: 'ja', name: 'ja' } as never],
		current: { id, language: 'zh', name: 'zh' } as never
	});
}

function setup(data: Partial<StudyData> = {}) {
	vi.mocked(currentStudyDay).mockReturnValue(day);
	select(1);
	vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [], ...data });
	vi.mocked(fetchActivity).mockResolvedValue({ from: today, to: today, timeZone: 'UTC', sources: SOURCES, cells: [] });
	return render(GoalSettings);
}

const goal = (metric: string, target: number, showStreak = true) => ({
	version: 1 as const,
	showStreak,
	history: [{ from: '2026-01-01', metric: metric as 'activity:review', target }]
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

async function form() {
	await screen.findByRole('heading', { name: 'Daily goal' });
	await waitFor(() => expect((screen.getByLabelText('Count') as HTMLSelectElement).disabled).toBe(false));
	return {
		metric: screen.getByLabelText('Count') as HTMLSelectElement,
		// The target field appears once something is chosen.
		get target() {
			return screen.getByLabelText('Target') as HTMLInputElement;
		},
		streak: screen.getByLabelText('Show goal streak') as HTMLInputElement
	};
}

describe('GoalSettings', () => {
	it('has one primary action; the metric is a Select and the target a number Field', async () => {
		setup({ goals: goal('activity:review', 50) });
		await form();
		expect(primaryActions(document.body)).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Save goal' }).className).toContain('primary');
		expect(screen.getByLabelText('Count').closest('.field')).toBeTruthy();
		expect(screen.getByLabelText('Target').closest('.field')).toBeTruthy();
		expect((screen.getByLabelText('Target') as HTMLInputElement).type).toBe('number');
	});

	it('lists the metrics from the activity sources (one request for today)', async () => {
		setup();
		const { metric } = await form();
		expect([...metric.options].map((o) => o.textContent?.trim())).toEqual([
			'No daily goal',
			'Flashcard reviews',
			'New cards',
			'Flashcard study time',
			'Reading'
		]);
		expect(fetchActivity).toHaveBeenCalledTimes(1);
		expect(vi.mocked(fetchActivity).mock.calls[0].slice(0, 2)).toEqual([today, today]);
	});

	it('saves the planned row', async () => {
		setup();
		const f = await form();
		expect(screen.queryByLabelText('Target')).toBeNull();
		await fireEvent.change(f.metric, { target: { value: 'activity:review' } });
		await fireEvent.input(f.target, { target: { value: '50' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));
		await waitFor(() => expect(saveGoals).toHaveBeenCalledTimes(1));
		expect(vi.mocked(saveGoals).mock.calls[0][1]).toEqual({
			version: 1,
			showStreak: true,
			history: [{ from: today, metric: 'activity:review', target: 50 }]
		});
		expect(vi.mocked(saveGoals).mock.calls[0][0]).toBe(1);
		expect(await screen.findByText('Saved.')).toBeTruthy();
	});

	it('writes nothing without a change', async () => {
		setup({ goals: goal('activity:review', 50) });
		const { metric, target } = await form();
		expect(metric.value).toBe('activity:review');
		expect(target.value).toBe('50');
		await fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));
		expect(await screen.findByText('No changes')).toBeTruthy();
		expect(saveGoals).not.toHaveBeenCalled();
	});

	it('shows the range error per unit', async () => {
		setup();
		const f = await form();
		await fireEvent.change(f.metric, { target: { value: 'activity:read' } });
		await fireEvent.input(f.target, { target: { value: '2000' } });
		expect(screen.getByText('minutes')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));
		expect((await screen.findByRole('alert')).textContent).toContain('Enter a whole number of minutes from 1 to 1440');
		expect(saveGoals).not.toHaveBeenCalled();
	});

	it('Remove goal appends a null entry', async () => {
		setup({ goals: goal('activity:review', 50) });
		await form();
		await fireEvent.click(screen.getByRole('button', { name: 'Remove goal' }));
		await waitFor(() => expect(saveGoals).toHaveBeenCalledTimes(1));
		expect(vi.mocked(saveGoals).mock.calls[0][1].history).toEqual([
			{ from: '2026-01-01', metric: 'activity:review', target: 50 },
			{ from: today, metric: null, target: null }
		]);
	});

	it('the streak checkbox changes only showStreak', async () => {
		setup({ goals: goal('activity:review', 50) });
		const { streak } = await form();
		expect(streak.checked).toBe(true);
		await fireEvent.click(streak);
		await fireEvent.click(screen.getByRole('button', { name: 'Save goal' }));
		await waitFor(() => expect(saveGoals).toHaveBeenCalledTimes(1));
		expect(vi.mocked(saveGoals).mock.calls[0][1]).toEqual(goal('activity:review', 50, false));
	});

	it('hints at the new-card limit', async () => {
		setup({ limits: { workspace: { new: 20 }, decks: {} } });
		const f = await form();
		await fireEvent.change(f.metric, { target: { value: 'flashcards:new' } });
		await fireEvent.input(f.target, { target: { value: '30' } });
		expect(screen.getByText('Your daily new-card limit is 20; raise it to reach this goal')).toBeTruthy();
	});

	it('a newer row disables the form with a note', async () => {
		setup({ goals: 'newer' });
		await screen.findByText(/set by a newer version of qinqin/);
		expect((screen.getByLabelText('Count') as HTMLSelectElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'Save goal' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('re-reads the form after a workspace switch', async () => {
		setup({ goals: goal('activity:review', 50) });
		const { target } = await form();
		expect(target.value).toBe('50');
		vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [], goals: goal('flashcards:new', 7) });
		select(2);
		await waitFor(() => expect((screen.getByLabelText('Target') as HTMLInputElement).value).toBe('7'));
		expect(vi.mocked(getStudyData).mock.calls.map((c) => c[0])).toContain(2);
		expect((screen.getByLabelText('Count') as HTMLSelectElement).value).toBe('flashcards:new');
	});

	it('writes to the workspace the form was loaded for, never a newer one', async () => {
		setup({ goals: goal('activity:review', 50) });
		await form();
		// Workspace 2 is still loading: the form is disabled, nothing is written.
		vi.mocked(getStudyData).mockReturnValue(new Promise(() => {}));
		select(2);
		await waitFor(() =>
			expect((screen.getByRole('button', { name: 'Save goal' }) as HTMLButtonElement).disabled).toBe(true)
		);
		await fireEvent.click(screen.getByRole('button', { name: 'Remove goal' }));
		expect(saveGoals).not.toHaveBeenCalled();
	});

	it('works offline with the built-in choices and offers Try again', async () => {
		setup({ goals: goal('flashcards:new', 5) });
		vi.mocked(fetchActivity).mockRejectedValue(new Error('offline'));
		cleanup();
		render(GoalSettings);
		const { metric, target } = await form();
		expect(target.value).toBe('5');
		expect([...metric.options].map((o) => o.textContent?.trim())).toEqual([
			'No daily goal',
			'Flashcard reviews',
			'New cards',
			'Flashcard study time',
			'Journal entries',
			'Reading'
		]);
		expect(screen.getByText(/Could not load the activity list/)).toBeTruthy();
		vi.mocked(fetchActivity).mockResolvedValue({ from: today, to: today, timeZone: 'UTC', sources: SOURCES, cells: [] });
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		await waitFor(() => expect(screen.queryByText(/Could not load the activity list/)).toBeNull());
		expect([...metric.options].map((o) => o.textContent?.trim())).not.toContain('Journal entries');
	});

	it('shows a load error with Try again when the goal row cannot be read', async () => {
		setup();
		vi.mocked(getStudyData).mockRejectedValueOnce(new Error('offline'));
		cleanup();
		render(GoalSettings);
		expect((await screen.findByRole('alert')).textContent).toContain('Could not load your daily goal.');
		vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [], goals: goal('activity:review', 9) });
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		await waitFor(() => expect((screen.getByLabelText('Target') as HTMLInputElement).value).toBe('9'));
	});
});
