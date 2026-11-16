import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/time/zone', () => ({
	currentStudyDay: vi.fn(),
	currentStudyHistory: vi.fn(() => []),
	onStudyDayChange: vi.fn(() => () => {})
}));
vi.mock('$lib/study/studyData', () => ({ getStudyData: vi.fn() }));
vi.mock('$lib/events', () => ({ loadWorkspaceEvents: vi.fn() }));
vi.mock('$lib/api/stats', () => ({
	fetchActivity: vi.fn(() => Promise.resolve({ from: '', to: '', timeZone: 'UTC', sources: [], cells: [] }))
}));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	saveVacation: vi.fn(() => Promise.resolve()),
	saveWorkspaceLimits: vi.fn(() => Promise.resolve()),
	deleteVacation: vi.fn(() => Promise.resolve())
}));

vi.mock('$lib/notes/store', () => ({
	loadNoteCfg: vi.fn(() => Promise.resolve({ onAnswer: true, extra: {} })),
	saveNoteCfg: vi.fn(() => Promise.resolve())
}));

import { loadWorkspaceEvents } from '$lib/events';
import { loadNoteCfg, saveNoteCfg } from '$lib/notes/store';
import { deleteVacation, saveVacation, saveWorkspaceLimits } from '$lib/study/store';
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
		const cancel = await screen.findAllByRole('button', { name: /^Cancel/ });
		expect(cancel).toHaveLength(1);
		// Only the active period can be ended; the scheduled one only cancelled.
		expect(screen.getAllByRole('button', { name: /^End now/ })).toHaveLength(1);
		expect(cancel[0].getAttribute('aria-label')).toMatch(/^Cancel vacation /);
		expect(screen.getByRole('button', { name: /^End now/ }).getAttribute('aria-label')).toMatch(/^End now: /);
		await fireEvent.click(cancel[0]);
		await waitFor(() => expect(deleteVacation).toHaveBeenCalledWith('S'));
	});

	it('ends an active period early by writing the day before today', async () => {
		const start = later(-3);
		setup([period({ id: 'A', start, end: later(5), createdDay: start })]);
		await fireEvent.click(await screen.findByRole('button', { name: /^End now/ }));
		await waitFor(() => expect(saveVacation).toHaveBeenCalled());
		expect(vi.mocked(saveVacation).mock.calls[0][0]).toMatchObject({ id: 'A', end: later(-1) });
	});
});

describe('StudySettings messages', () => {
	it('explains a start tomorrow whose end is today', async () => {
		setup([], [`${today}T00:00:01Z`]);
		await screen.findByRole('heading', { name: 'Vacation' });
		await fireEvent.click(screen.getByLabelText('Until'));
		await fireEvent.input(screen.getByLabelText('End date'), { target: { value: today } });
		await fireEvent.click(screen.getByRole('button', { name: 'Start vacation' }));
		expect((await screen.findByRole('alert')).textContent).toBe(
			'Your vacation starts tomorrow because you already studied today; the end cannot be before that.'
		);
		expect(saveVacation).not.toHaveBeenCalled();
	});

	it('asks for a start date when none is chosen', async () => {
		setup();
		await screen.findByRole('heading', { name: 'Vacation' });
		await fireEvent.click(screen.getByLabelText('On a date'));
		await fireEvent.submit(screen.getByRole('button', { name: 'Schedule vacation' }).closest('form')!);
		expect((await screen.findByRole('alert')).textContent).toBe('Choose a start date.');
	});
});

describe('StudySettings daily limits', () => {
	it('shows the defaults and saves new values and unlimited reviews', async () => {
		setup();
		const newValue = (await screen.findByLabelText('New cards per day value')) as HTMLInputElement;
		expect(newValue.value).toBe('20');
		expect((screen.getByLabelText('Reviews per day value') as HTMLInputElement).value).toBe('200');
		await fireEvent.input(newValue, { target: { value: '12' } });
		await fireEvent.click(screen.getAllByLabelText('Unlimited')[1]);
		await fireEvent.click(screen.getByRole('button', { name: 'Save limits' }));
		await waitFor(() => expect(saveWorkspaceLimits).toHaveBeenCalledWith({ new: 12, reviews: null }));
	});

	it('refuses a bad value', async () => {
		setup();
		const newValue = await screen.findByLabelText('New cards per day value');
		await fireEvent.input(newValue, { target: { value: '-3' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Save limits' }));
		expect((await screen.findByRole('alert')).textContent).toBe('Enter a whole number from 0 to 9999.');
		expect(saveWorkspaceLimits).not.toHaveBeenCalled();
	});
});

describe('StudySettings limits wording', () => {
	it('says the limits are per deck and the workspace value is the default', async () => {
		setup();
		expect((await screen.findByText(/Each deck gets at most/)).textContent).toMatch(/workspace value is the default for every deck/);
	});
});

describe('StudySettings daily goal', () => {
	it('has the daily goal section above the vacation section', async () => {
		setup();
		const goal = await screen.findByRole('heading', { name: 'Daily goal' });
		const vacation = screen.getByRole('heading', { name: 'Vacation' });
		expect(goal.compareDocumentPosition(vacation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});

describe('StudySettings note switch', () => {
	const label = 'Show my notes on the answer side';

	it('is checked by default in the workspace part', async () => {
		setup();
		const box = (await screen.findByLabelText(label)) as HTMLInputElement;
		await waitFor(() => expect(loadNoteCfg).toHaveBeenCalledWith(1));
		expect(box.checked).toBe(true);
		const limits = screen.getByRole('heading', { name: 'Daily limits' });
		expect(limits.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('unchecking stores notecfg off and keeps unknown members of the loaded row', async () => {
		vi.mocked(loadNoteCfg).mockResolvedValueOnce({ onAnswer: true, extra: { later: 1 } });
		setup();
		const box = (await screen.findByLabelText(label)) as HTMLInputElement;
		await waitFor(() => expect(loadNoteCfg).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		await fireEvent.click(box);
		await waitFor(() => expect(saveNoteCfg).toHaveBeenCalledWith(1, false, { onAnswer: true, extra: { later: 1 } }));
		expect(box.checked).toBe(false);
	});

	it('shows a stored off value', async () => {
		vi.mocked(loadNoteCfg).mockResolvedValueOnce({ onAnswer: false, extra: {} });
		setup();
		const box = (await screen.findByLabelText(label)) as HTMLInputElement;
		await waitFor(() => expect(box.checked).toBe(false));
	});

	it('a failed save reverts the box and shows an alert', async () => {
		vi.mocked(saveNoteCfg).mockRejectedValueOnce(new Error('offline'));
		setup();
		const box = (await screen.findByLabelText(label)) as HTMLInputElement;
		await waitFor(() => expect(loadNoteCfg).toHaveBeenCalled());
		await new Promise((r) => setTimeout(r, 0));
		await fireEvent.click(box);
		expect((await screen.findByRole('alert')).textContent).toMatch(/could not save/i);
		expect(box.checked).toBe(true);
	});
});
