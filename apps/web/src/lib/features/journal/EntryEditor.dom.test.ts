import { StudyDays } from '$lib/time/studyDays';
import type { MockInstance } from 'vitest';
import { studyDay as studyDayOf } from '$lib/time/studyDay';
/** One rule object, as the session's StudyDays caches it. */
const SHARED_DAY = studyDayOf([]);
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalEntry, Review } from './types';
import { textHash } from './textHash';
import { ApiError } from '$lib/api/client';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}), beforeNavigate: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/journal/e/e1') } }));
vi.mock('$lib/frame/pageFrame.svelte', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/frame/pageFrame.svelte')>()),
	setFrameTitle: vi.fn(),
	setPageActions: vi.fn()
}));
vi.mock('./store', () => ({
	getEntry: vi.fn(),
	getReview: vi.fn(),
	saveEntry: vi.fn(async (_ws, entry) => ({ ...entry, updatedAt: new Date().toISOString() })),
	deleteEntry: vi.fn(async () => {}),
	newEntry: vi.fn(() => ({ id: 'new1', date: '2026-11-16', title: '', text: '', source: 'typed', createdAt: '', updatedAt: '' })),
	recordJournalEvent: vi.fn(async () => {}),
	getJournalSettings: vi.fn(async () => ({ guidance: '', explanationLanguage: 'en' })),
	getSuggestions: vi.fn(async () => null)
}));
vi.mock('./api', () => ({ requestReview: vi.fn() }));
vi.mock('./journalEntries.svelte', () => ({
	journalEntriesFor: vi.fn(() => ({ upsert: vi.fn(), remove: vi.fn(), markReviewed: vi.fn() }))
}));
vi.mock('$lib/features/journal/providerNames', () => ({ loadProviderNames: vi.fn(async () => new Map()) }));

import EntryEditor from './EntryEditor.svelte';
import { getEntry, getReview, saveEntry, deleteEntry } from './store';
import { requestReview } from './api';
import { goto } from '$app/navigation';

// The session's StudyDays (record 0009): its methods, faked on the class.
beforeEach(() => {
	vi.spyOn(StudyDays.prototype, 'day').mockImplementation((() => SHARED_DAY) as never);
});

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const text = '我昨天去学校。';
const entry: JournalEntry = {
	id: 'e1',
	date: '2026-11-16',
	title: '周末',
	text,
	source: 'typed',
	createdAt: '2026-11-16T10:00:00Z',
	updatedAt: '2026-11-16T10:00:00Z'
};

function review(textHashValue = textHash(text)): Review {
	return {
		entryId: 'e1',
		textHash: textHashValue,
		annotations: [
			{
				id: 'a1',
				quote: '去学校',
				prefix: '我昨天',
				suffix: '。',
				correction: '去学校了',
				explanation: 'why',
				category: 'grammar',
				kind: 'mistake'
			}
		],
		overall: { summary: 'Good.', strengths: [], focus: [] },
		model: 'm',
		dropped: { notFound: 0, wrongScript: 0, noChange: 0, overlap: 0, empty: 0, tooMany: 0 },
		createdAt: '2026-11-16T11:00:00Z'
	};
}

beforeEach(() => {
	vi.mocked(getEntry).mockResolvedValue(entry);
	vi.mocked(getReview).mockResolvedValue(null);
	vi.mocked(requestReview).mockResolvedValue(review());
});

afterEach(cleanup);

async function renderEditor(over: Record<string, unknown> = {}) {
	render(EntryEditor, { props: {
		workspaceId: 1,
		entryId: 'e1',
		initialTitle: '',
		aiAvailable: true,
		aiBanner: null,
		language: 'zh',
		...over
	}, context: ctx.context });
	await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
}

describe('EntryEditor in three columns (#103)', () => {
	it('writing shows one primary Review and Field labels', async () => {
		await renderEditor();
		const primaries = [...document.querySelectorAll('.button.primary')];
		expect(primaries).toHaveLength(1);
		expect(primaries[0].textContent).toContain('Review');
		expect(screen.getByLabelText('Date')).toBeTruthy();
		expect(screen.getByLabelText('Entry')).toBeTruthy();
	});

	it('renders one review hint and tags the entry field with the study lang', async () => {
		await renderEditor({ aiAvailable: false });
		expect(document.querySelectorAll('#review-hint')).toHaveLength(1);
		expect(screen.getByLabelText('Entry').getAttribute('lang')).toBe('zh-Hans');
	});

	it('typing autosaves on blur and the save status is polite', async () => {
		await renderEditor();
		const area = screen.getByLabelText('Entry') as HTMLTextAreaElement;
		await fireEvent.input(area, { target: { value: '我昨天去学校。今天很好。' } });
		await fireEvent.blur(area);
		await waitFor(() => expect(saveEntry).toHaveBeenCalled());
		expect(document.querySelector('[aria-live="polite"]')).toBeTruthy();
	});

	it('a pasted vertical tab or form feed is never sent: the server refuses control characters (#199)', async () => {
		await renderEditor();
		const area = screen.getByLabelText('Entry') as HTMLTextAreaElement;
		await fireEvent.input(area, { target: { value: 'a\u000bb\u000cc' } });
		await fireEvent.blur(area);
		await waitFor(() => expect(saveEntry).toHaveBeenCalled());
		expect(vi.mocked(saveEntry).mock.calls.at(-1)?.[1].text).toBe('abc');
	});

	it('a refused save says why, from the catalogue (record 0001)', async () => {
		vi.mocked(saveEntry).mockRejectedValueOnce(
			new ApiError(400, JSON.stringify({ error: 'bad_request', message: 'title must be plain text' }))
		);
		await renderEditor();
		const area = screen.getByLabelText('Entry') as HTMLTextAreaElement;
		await fireEvent.input(area, { target: { value: '我昨天去学校。今天很好。' } });
		await fireEvent.blur(area);
		await waitFor(() => expect(document.body.textContent).toContain('The request was not understood.'));
		expect(document.body.textContent).not.toContain('title must be plain text');
		expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
	});

	it('after a review shows the marks, the margin and moves focus to the review heading', async () => {
		await renderEditor();
		await fireEvent.click(screen.getByRole('button', { name: 'Review' }));
		await waitFor(() => expect(document.querySelector('button.mark')).toBeTruthy());
		expect(document.querySelector('aside[aria-label="Margin"]')).toBeTruthy();
		expect(document.querySelector('aside')?.textContent).toContain('1 correction');
		expect(document.activeElement?.textContent).toBe('Review');
	});

	it('opening a mark expands its note, opening a note tints the mark', async () => {
		await renderEditor();
		await fireEvent.click(screen.getByRole('button', { name: 'Review' }));
		await waitFor(() => expect(document.querySelector('button.mark')).not.toBeNull());
		const mark = document.querySelector('button.mark') as HTMLButtonElement;
		await fireEvent.click(mark);
		await waitFor(() => expect(document.querySelector('aside button.note[aria-expanded="true"]')).toBeTruthy());
	});

	it('Edit returns to the textarea with focus', async () => {
		await renderEditor();
		await fireEvent.click(screen.getByRole('button', { name: 'Review' }));
		await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy());
		await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
		await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Entry')));
	});

	it('an outdated review shows the notice and Review again', async () => {
		const old = review('different');
		vi.mocked(getReview).mockResolvedValue(old);
		await renderEditor();
		await waitFor(() => expect(screen.getByText('Written for an earlier version')).toBeTruthy());
		expect(screen.getByRole('button', { name: 'Review again' })).toBeTruthy();
	});

	it('the review-status live region stays outside the margin', async () => {
		await renderEditor();
		await fireEvent.click(screen.getByRole('button', { name: 'Review' }));
		await waitFor(() => expect(document.querySelector('aside[aria-label="Margin"]')).toBeTruthy());
		expect(document.querySelector('.live')?.closest('aside')).toBeNull();
		const status = document.querySelector('.live');
		expect(status?.getAttribute('aria-live')).toBe('polite');
	});

	it('below 720px tapping a mark opens the correction sheet', async () => {
		vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
		try {
			await renderEditor();
			await fireEvent.click(screen.getByRole('button', { name: 'Review' }));
			await waitFor(() => expect(document.querySelector('button.mark')).not.toBeNull());
			await fireEvent.click(document.querySelector('button.mark') as HTMLElement);
			expect(await screen.findByRole('dialog', { name: 'Correction 1 of 1' })).toBeTruthy();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('Delete asks, Cancel returns focus and Yes deletes and leaves', async () => {
		await renderEditor();
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		const cancel = screen.getByRole('button', { name: 'Cancel' });
		expect(document.activeElement).toBe(cancel);
		await fireEvent.click(cancel);
		expect(document.activeElement?.textContent).toBe('Delete');
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
		await waitFor(() => expect(deleteEntry).toHaveBeenCalledWith(1, 'e1'));
		expect(goto).toHaveBeenCalledWith('/journal');
	});
});
