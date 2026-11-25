import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testContext, type TestContext } from '$lib/testing/context';

vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(), getSchemeEntries: vi.fn() }));
vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	getStudyData: vi.fn()
}));
vi.mock('$lib/study/commands/keyed', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/commands/keyed')>()),
	setKnownMarks: vi.fn(() => Promise.resolve())
}));

import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
import { setKnownMarks } from '$lib/study/commands/keyed';
import { getStudyData } from '$lib/study/data';
import type { StudyData } from '$lib/study/types';
import KnownSettings from './KnownSettings.svelte';

const word = (id: number) => ({ id, language: 'zh', kind: 'word', written: `字${id}`, readings: [], attrs: {}, radicalId: null });
const LEVELS: Record<string, number[]> = { 'HSK 1': [1, 2, 3], 'HSK 2': [4, 5], 'HSK 3': [6, 7, 8] };

let ctx: TestContext;
beforeEach(() => {
	vi.clearAllMocks();
	ctx = testContext();
	ctx.session.workspaces.set({
		list: [{ id: 1, language: 'zh', name: 'zh' } as never],
		current: { id: 1, language: 'zh', name: 'zh' } as never
	});
	vi.mocked(getSchemes).mockResolvedValue([
		{
			id: 9,
			name: 'HSK',
			unit: 'word',
			language: 'zh',
			packId: 'hsk-words',
			levels: [
				{ id: 1, ord: 1, name: 'HSK 1' },
				{ id: 2, ord: 2, name: 'HSK 2' },
				{ id: 3, ord: 3, name: 'HSK 3' }
			]
		}
	]);
	vi.mocked(getSchemeEntries).mockImplementation(async (_id, level) => (LEVELS[level ?? ''] ?? []).map(word));
});
afterEach(() => cleanup());

function study(data: Partial<StudyData> = {}): void {
	vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [], ...data });
}

describe('KnownSettings', () => {
	it('previews the new entries of a range, asks to confirm and writes one batch', async () => {
		study({ known: [1] });
		render(KnownSettings, { context: ctx.context });
		// Default range: up to the second level = 5 entries, 1 already marked.
		await screen.findByText('4 new entries would be marked as known.');
		await fireEvent.click(screen.getByTestId('known-mark'));
		expect(screen.getByText(/Mark 4 entries as known\?/)).toBeTruthy();
		expect(setKnownMarks).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByTestId('known-confirm'));
		await waitFor(() => expect(setKnownMarks).toHaveBeenCalledTimes(1));
		const [, ws, ids, on, opts] = vi.mocked(setKnownMarks).mock.calls[0] as unknown as [unknown, number, number[], boolean, { batch: { id: string; source: string; scope: string } }];
		expect(ws).toBe(1);
		expect(ids).toEqual([2, 3, 4, 5]);
		expect(on).toBe(true);
		expect(opts.batch).toMatchObject({ source: 'range', scope: 'HSK · HSK 2' });
		expect(opts.batch.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		await screen.findByText('4 entries marked as known.');
	});

	it('cancelling the confirmation writes nothing', async () => {
		study();
		render(KnownSettings, { context: ctx.context });
		await screen.findByText('5 new entries would be marked as known.');
		await fireEvent.click(screen.getByTestId('known-mark'));
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(setKnownMarks).not.toHaveBeenCalled();
		expect(screen.getByTestId('known-mark')).toBeTruthy();
	});

	it('lists declarations and undoes exactly their entries', async () => {
		study({
			known: [4, 5, 20],
			knownDeclared: [
				{ entryId: 4, createdAt: '2026-11-26T10:00:00.000Z', batch: { id: 'B1', source: 'placement', scope: 'HSK · HSK 2' } },
				{ entryId: 5, createdAt: '2026-11-26T10:00:00.000Z', batch: { id: 'B1', source: 'placement', scope: 'HSK · HSK 2' } }
			]
		});
		render(KnownSettings, { context: ctx.context });
		await screen.findByText('HSK · HSK 2');
		expect(screen.getByText(/Placement test, .*, 2 entries/)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
		await waitFor(() => expect(setKnownMarks).toHaveBeenCalledWith(expect.anything(), 1, [4, 5], false));
		await screen.findByText('Declaration undone.');
	});

	it('a failed write is reported, not success', async () => {
		study();
		vi.mocked(setKnownMarks).mockRejectedValueOnce(new Error('offline'));
		render(KnownSettings, { context: ctx.context });
		await screen.findByText('5 new entries would be marked as known.');
		await fireEvent.click(screen.getByTestId('known-mark'));
		await fireEvent.click(screen.getByTestId('known-confirm'));
		await screen.findByText(/Not everything could be saved/);
		expect(screen.queryByText(/^\d+ entries marked as known\.$/)).toBeNull();
	});

	it('placement: a result is proposed first and nothing is written until it is confirmed', async () => {
		study();
		render(KnownSettings, { context: ctx.context });
		await screen.findByText('5 new entries would be marked as known.');
		await fireEvent.click(screen.getByTestId('placement-start'));
		// A learner who knows everything: 3 + 3 answers through the bisection.
		for (let i = 0; i < 12 && screen.queryByTestId('placement-question'); i++) {
			await fireEvent.click(screen.getByTestId('placement-know'));
		}
		await screen.findByTestId('placement-result');
		expect(screen.getByText('Your level looks like HSK 3.')).toBeTruthy();
		expect(setKnownMarks).not.toHaveBeenCalled();
		await fireEvent.click(screen.getByTestId('placement-confirm'));
		await waitFor(() => expect(setKnownMarks).toHaveBeenCalledTimes(1));
		const call = vi.mocked(setKnownMarks).mock.calls[0] as unknown as [unknown, number, number[], boolean, { batch: { source: string } }];
		expect(call[2]).toHaveLength(8);
		expect(call[4].batch.source).toBe('placement');
	});

	it('placement: the proposal can be lowered, or dropped, before marking', async () => {
		study();
		render(KnownSettings, { context: ctx.context });
		await screen.findByText('5 new entries would be marked as known.');
		await fireEvent.click(screen.getByTestId('placement-start'));
		for (let i = 0; i < 12 && screen.queryByTestId('placement-question'); i++) {
			await fireEvent.click(screen.getByTestId('placement-unsure'));
		}
		await screen.findByText('You are at the start: no level passed.');
		const confirm = screen.getByTestId('placement-confirm') as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: "Don't mark anything" }));
		expect(setKnownMarks).not.toHaveBeenCalled();
		expect(screen.getByTestId('known-mark')).toBeTruthy();
	});

	it('says so when no level list is installed', async () => {
		vi.mocked(getSchemes).mockResolvedValue([]);
		study();
		render(KnownSettings, { context: ctx.context });
		await screen.findByText(/No level list is installed/);
	});
});
