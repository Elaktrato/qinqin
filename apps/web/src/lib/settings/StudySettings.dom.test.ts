import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/time/zone', () => ({
	currentStudyDay: vi.fn(),
	currentStudyHistory: vi.fn(() => []),
	onStudyDayChange: vi.fn(() => () => {})
}));
vi.mock('$lib/study/studyData', () => ({ getStudyData: vi.fn() }));
vi.mock('$lib/events', () => ({ loadWorkspaceEvents: vi.fn() }));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	saveVacation: vi.fn(() => Promise.resolve()),
	deleteVacation: vi.fn(() => Promise.resolve())
}));

import { loadWorkspaceEvents } from '$lib/events';
import { deleteVacation, saveVacation } from '$lib/study/store';
import { getStudyData } from '$lib/study/studyData';
import type { VacationPeriod } from '$lib/study/vacation';
import { studyDay } from '$lib/time/studyDay';
import { currentStudyDay } from '$lib/time/zone';
import { workspaces } from '$lib/workspaces';
import StudySettings from './StudySettings.svelte';

const day = studyDay([]);
const today = day.today();
const later = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function period(over: Partial<VacationPeriod>): VacationPeriod {
	return { version: 1, id: 'P1', start: later(10), end: later(20), scope: 'all', createdDay: today, createdAt: `${today}T08:00:00Z`, ...over };
}

function setup(vacations: VacationPeriod[] = [], reviewTs: string[] = []) {
	vi.mocked(currentStudyDay).mockReturnValue(day);
	workspaces.set({
		list: [
			{ id: 1, language: 'zh', name: 'zh' } as never,
			{ id: 2, language: 'ja', name: 'ja' } as never
		],
		current: { id: 1, language: 'zh', name: 'zh' } as never
	});
	vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [], vacations });
	vi.mocked(loadWorkspaceEvents).mockResolvedValue(
		reviewTs.map((ts, i) => ({ id: `e${i}`, workspaceId: 1, device: 'w', ts, type: 'review', payload: {} })) as never
	);
	return render(StudySettings);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('StudySettings vacation', () => {
	it('starts a vacation now when nothing was studied today', async () => {
		setup();
		await screen.findByRole('heading', { name: 'Vacation' });
		await fireEvent.click(screen.getByRole('button', { name: 'Start vacation' }));
		await waitFor(() => expect(saveVacation).toHaveBeenCalledTimes(1));
		const saved = vi.mocked(saveVacation).mock.calls[0][0];
		expect(saved).toMatchObject({ start: today, end: null, scope: 'all', createdDay: today });
	});

	it('starts tomorrow after studying today and says so', async () => {
		setup([], [`${today}T00:00:01Z`]);
		await screen.findByRole('heading', { name: 'Vacation' });
		await fireEvent.click(screen.getByRole('button', { name: 'Start vacation' }));
		await waitFor(() => expect(saveVacation).toHaveBeenCalled());
		expect(vi.mocked(saveVacation).mock.calls[0][0].start).toBe(later(1));
		expect(await screen.findByText('Starts tomorrow — you already studied today')).toBeTruthy();
	});

	it('schedules a vacation on a date with an end date, the date input starting today', async () => {
		setup();
		await screen.findByRole('heading', { name: 'Vacation' });
		await fireEvent.click(screen.getByLabelText('On a date'));
		const start = screen.getByLabelText('Start date') as HTMLInputElement;
		expect(start.min).toBe(today);
		await fireEvent.input(start, { target: { value: later(5) } });
		await fireEvent.click(screen.getByLabelText('Until'));
		await fireEvent.input(screen.getByLabelText('End date'), { target: { value: later(9) } });
		await fireEvent.click(screen.getByRole('button', { name: 'Schedule vacation' }));
		await waitFor(() => expect(saveVacation).toHaveBeenCalled());
		expect(vi.mocked(saveVacation).mock.calls[0][0]).toMatchObject({ start: later(5), end: later(9) });
	});

	it('limits a vacation to the chosen workspaces and refuses an empty choice', async () => {
		setup();
		await screen.findByRole('heading', { name: 'Vacation' });
		await fireEvent.click(screen.getByLabelText('Chosen workspaces'));
		await fireEvent.click(screen.getByRole('button', { name: 'Start vacation' }));
		expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Choose at least one workspace.');
		expect(saveVacation).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByLabelText('zh'));
		await fireEvent.click(screen.getByRole('button', { name: 'Start vacation' }));
		await waitFor(() => expect(saveVacation).toHaveBeenCalled());
		expect(vi.mocked(saveVacation).mock.calls[0][0].scope).toEqual({ workspaces: [1] });
	});

	it('lists a scheduled period with Cancel and an active one with End now only', async () => {
		setup([period({ id: 'S' }), period({ id: 'A', start: today, end: later(3) })]);
		const cancel = await screen.findAllByRole('button', { name: 'Cancel' });
		expect(cancel).toHaveLength(1);
		expect(screen.getAllByRole('button', { name: 'End now' })).toHaveLength(2);
		await fireEvent.click(cancel[0]);
		await waitFor(() => expect(deleteVacation).toHaveBeenCalledWith('S'));
	});

	it('ends an active period early by writing the day before today', async () => {
		const start = later(-3);
		setup([period({ id: 'A', start, end: later(5), createdDay: start })]);
		await fireEvent.click(await screen.findByRole('button', { name: 'End now' }));
		await waitFor(() => expect(saveVacation).toHaveBeenCalled());
		expect(vi.mocked(saveVacation).mock.calls[0][0]).toMatchObject({ id: 'A', end: later(-1) });
	});
});
