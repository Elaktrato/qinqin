import { StudyDays } from '$lib/time/studyDays';
import type { MockInstance } from 'vitest';
import { studyDay as studyDayOf } from '$lib/time/studyDay';
/** One rule object, as the session's StudyDays caches it. */
const SHARED_DAY = studyDayOf([]);
import { EventLog } from '$lib/events';
import type { WorkspacesState } from '$lib/workspace/workspaces.svelte';
import { testContext, type TestContext, updateWorkspaces } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	getStudyData: vi.fn()
}));
vi.mock('$lib/studycore/commands/keyed', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/commands/keyed')>()),
	saveVacation: vi.fn(() => Promise.resolve()),
	deleteVacation: vi.fn(() => Promise.resolve())
}));
vi.mock('$lib/features/flashcards/commands/settings', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/features/flashcards/commands/settings')>()),
	saveWorkspaceLimits: vi.fn(() => Promise.resolve())
}));
vi.mock('$lib/api/stats', () => ({
	fetchActivity: vi.fn(() => Promise.resolve({ from: '', to: '', timeZone: 'UTC', sources: [], cells: [] }))
}));

vi.mock('$lib/notes/store', () => ({
	loadNoteCfg: vi.fn(() => Promise.resolve({ onAnswer: true, extra: {} })),
	saveNoteCfg: vi.fn(() => Promise.resolve())
}));

import { loadNoteCfg, saveNoteCfg } from '$lib/notes/store';
import { deleteVacation, saveVacation } from '$lib/studycore/commands/keyed';
import { saveWorkspaceLimits } from '$lib/features/flashcards/commands/settings';
import { getStudyData } from '$lib/studycore/data';
import type { VacationPeriod } from '$lib/studycore/vacation';
import { studyDay } from '$lib/time/studyDay';
import { primaryActions } from '$lib/ui/testing/primary';
import StudySettings from './StudySettings.svelte';

// The session's StudyDays (record 0009): its methods, faked on the class.
let currentStudyDay!: MockInstance<StudyDays['day']>;
beforeEach(() => {
	currentStudyDay = vi.spyOn(StudyDays.prototype, 'day').mockImplementation((() => SHARED_DAY) as never);
	vi.spyOn(StudyDays.prototype, 'effectiveHistory').mockImplementation((() => []) as never);
	vi.spyOn(StudyDays.prototype, 'onChange').mockImplementation((() => () => {}) as never);
});

// The session's event log (record 0009): its methods, faked on the class.
let loadWorkspaceEvents!: MockInstance<EventLog['load']>;
beforeEach(() => {
	loadWorkspaceEvents = vi.spyOn(EventLog.prototype, 'load').mockImplementation(((async () => [])) as never);
});

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const day = studyDay([]);
const today = day.today();
const later = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function period(over: Partial<VacationPeriod>): VacationPeriod {
	return { version: 1, id: 'P1', start: later(10), end: later(20), scope: 'all', createdDay: today, createdAt: `${today}T08:00:00Z`, ...over };
}

function setup(vacations: VacationPeriod[] = [], reviewTs: string[] = []) {
	vi.mocked(currentStudyDay).mockReturnValue(day);
	ctx.session.workspaces.set({
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
	return render(StudySettings, { context: ctx.context });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('StudySettings vacation', () => {
	it('has one primary in the vacation form; its dates are Field underlines', async () => {
		setup();
		await screen.findByRole('heading', { name: 'Vacation' });
		const form = screen.getByRole('button', { name: 'Start vacation' }).closest('form')!;
		expect(primaryActions(form)).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Start vacation' }).className).toContain('primary');
		await fireEvent.click(screen.getByLabelText('On a date'));
		expect(screen.getByLabelText('Start date').closest('.field')).toBeTruthy();
		await fireEvent.click(screen.getByLabelText('Until'));
		expect(screen.getByLabelText('End date').closest('.field')).toBeTruthy();
	});

	it('starts a vacation now when nothing was studied today', async () => {
		setup();
		await screen.findByRole('heading', { name: 'Vacation' });
		await fireEvent.click(screen.getByRole('button', { name: 'Start vacation' }));
		await waitFor(() => expect(saveVacation).toHaveBeenCalledTimes(1));
		const saved = vi.mocked(saveVacation).mock.calls[0][1];
		expect(saved).toMatchObject({ start: today, end: null, scope: 'all', createdDay: today });
	});

	it('starts tomorrow after studying today and says so', async () => {
		setup([], [`${today}T00:00:01Z`]);
		await screen.findByRole('heading', { name: 'Vacation' });
		await fireEvent.click(screen.getByRole('button', { name: 'Start vacation' }));
		await waitFor(() => expect(saveVacation).toHaveBeenCalled());
		expect(vi.mocked(saveVacation).mock.calls[0][1].start).toBe(later(1));
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
		expect(vi.mocked(saveVacation).mock.calls[0][1]).toMatchObject({ start: later(5), end: later(9) });
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
		expect(vi.mocked(saveVacation).mock.calls[0][1].scope).toEqual({ workspaces: [1] });
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
		await waitFor(() => expect(deleteVacation).toHaveBeenCalledWith(expect.anything(), 'S'));
	});

	it('ends an active period early by writing the day before today', async () => {
		const start = later(-3);
		setup([period({ id: 'A', start, end: later(5), createdDay: start })]);
		await fireEvent.click(await screen.findByRole('button', { name: /^End now/ }));
		await waitFor(() => expect(saveVacation).toHaveBeenCalled());
		expect(vi.mocked(saveVacation).mock.calls[0][1]).toMatchObject({ id: 'A', end: later(-1) });
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
	it('has one primary in the limits form and number Fields for the values', async () => {
		setup();
		const save = await screen.findByRole('button', { name: 'Save limits' });
		expect(primaryActions(save.closest('form')!)).toHaveLength(1);
		expect(save.className).toContain('primary');
		expect((screen.getByLabelText('New cards per day value') as HTMLInputElement).type).toBe('number');
		expect(screen.getByLabelText('New cards per day value').closest('.field')).toBeTruthy();
	});

	it('shows the defaults and saves new values and unlimited reviews', async () => {
		setup();
		const newValue = (await screen.findByLabelText('New cards per day value')) as HTMLInputElement;
		expect(newValue.value).toBe('20');
		expect((screen.getByLabelText('Reviews per day value') as HTMLInputElement).value).toBe('200');
		await fireEvent.input(newValue, { target: { value: '12' } });
		await fireEvent.click(screen.getAllByLabelText('Unlimited')[1]);
		await fireEvent.click(screen.getByRole('button', { name: 'Save limits' }));
		await waitFor(() => expect(saveWorkspaceLimits).toHaveBeenCalledWith(expect.anything(), 1, { new: 12, reviews: null }));
	});

	it('a workspace switch: a late answer of the old workspace never fills the form, and saving goes to the shown one (#174)', async () => {
		const lateOnes: ((v: unknown) => void)[] = [];
		vi.mocked(currentStudyDay).mockReturnValue(day);
		vi.mocked(loadWorkspaceEvents).mockResolvedValue([]);
		vi.mocked(getStudyData).mockImplementation(async (_study, id: number) => {
			if (id === 1) return new Promise((r) => lateOnes.push(r)) as never;
			return { decks: [], cards: [], limits: { workspace: { new: 7 }, decks: {} } } as never;
		});
		ctx.session.workspaces.set({
			list: [{ id: 1, language: 'zh', name: 'zh' } as never, { id: 2, language: 'ja', name: 'ja' } as never],
			current: { id: 1, language: 'zh', name: 'zh' } as never
		});
		render(StudySettings, { context: ctx.context });
		await waitFor(() => expect(lateOnes.length).toBeGreaterThan(0));
		updateWorkspaces(ctx.session.workspaces, (w: WorkspacesState) => ({ ...w, current: { id: 2, language: 'ja', name: 'ja' } as never }));
		const newValue = (await screen.findByLabelText('New cards per day value')) as HTMLInputElement;
		await waitFor(() => expect(newValue.value).toBe('7'));
		for (const r of lateOnes) r({ decks: [], cards: [], limits: { workspace: { new: 3 }, decks: {} } });
		await new Promise((r) => setTimeout(r, 0));
		expect(newValue.value).toBe('7');
		await fireEvent.click(screen.getByRole('button', { name: 'Save limits' }));
		await waitFor(() => expect(saveWorkspaceLimits).toHaveBeenCalledWith(expect.anything(), 2, { new: 7, reviews: 200 }));
	});

	it('saves to the workspace whose limits the form shows, not one selected since (#174)', async () => {
		setup();
		const newValue = (await screen.findByLabelText('New cards per day value')) as HTMLInputElement;
		await fireEvent.input(newValue, { target: { value: '12' } });
		// Selected since, still loading: the form shows workspace 1.
		vi.mocked(getStudyData).mockImplementation(() => new Promise(() => undefined));
		updateWorkspaces(ctx.session.workspaces, (w: WorkspacesState) => ({ ...w, current: { id: 2, language: 'ja', name: 'ja' } as never }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save limits' }));
		await waitFor(() => expect(saveWorkspaceLimits).toHaveBeenCalled());
		expect(vi.mocked(saveWorkspaceLimits).mock.calls[0][1]).toBe(1);
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

	it('stays disabled until the stored value has loaded, then saves with its members', async () => {
		let resolve!: (v: { onAnswer: boolean; extra: Record<string, unknown> }) => void;
		vi.mocked(loadNoteCfg).mockReturnValueOnce(new Promise((r) => (resolve = r)));
		setup();
		const box = (await screen.findByLabelText(label)) as HTMLInputElement;
		expect(box.disabled).toBe(true);
		await fireEvent.click(box);
		expect(saveNoteCfg).not.toHaveBeenCalled();
		resolve({ onAnswer: false, extra: { later: 2 } });
		await waitFor(() => expect(box.disabled).toBe(false));
		expect(box.checked).toBe(false);
		await fireEvent.click(box);
		await waitFor(() => expect(saveNoteCfg).toHaveBeenCalledWith(1, true, { onAnswer: false, extra: { later: 2 } }));
		expect(box.checked).toBe(true);
	});

	it('a failed load reads as on and the box can be used', async () => {
		vi.mocked(loadNoteCfg).mockRejectedValueOnce(new Error('down'));
		setup();
		const box = (await screen.findByLabelText(label)) as HTMLInputElement;
		await waitFor(() => expect(box.disabled).toBe(false));
		expect(box.checked).toBe(true);
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
