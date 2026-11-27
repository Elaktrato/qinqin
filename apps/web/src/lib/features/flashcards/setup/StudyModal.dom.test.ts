import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(async () => []), getSchemeEntries: vi.fn(async () => []) }));
vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyHistory: vi.fn()
}));

import { getSchemes } from '$lib/api/schemes';
import type { Scheme } from '$lib/api/types';
import { loadStudyHistory } from '$lib/studycore/data';
import { SESSION_CONFIG_KEY } from '../session/session';
import { defaultSetup, type StudySetup } from './setup';
import { StudySetups } from './setupStore.svelte';
import { ApiError } from '$lib/api/client';
import { t } from '$lib/i18n';
import { testContext, type TestContext } from '$lib/testing/context';
import * as build from '$lib/testing/study';
import { studyDay } from '$lib/time/studyDay';
import StudyModal from './StudyModal.svelte';

let ctx: TestContext;
let saved: StudySetup;
let update: ReturnType<typeof vi.spyOn>;

const WRITTEN = ['', '学校', '水', '本', '私'];

function vocab(n: number, deckIds = ['general']) {
	return build.card({ id: `c-vocab-${n}`, kind: 'vocab', entryId: n, written: WRITTEN[n], deckIds, createdAt: `2026-01-0${n}T00:00:00.000Z` });
}

const DECK = { id: 'd1', name: 'Verbs', createdAt: '2026-01-01T00:00:00Z' };

function workspace(language: string): void {
	ctx.session.workspaces.set({ list: [{ id: 1, language, name: language } as never], current: { id: 1, language, name: language } as never });
}

async function open(): Promise<HTMLElement> {
	ctx.session.studyModal.show();
	render(StudyModal, { context: ctx.context });
	return screen.findByRole('dialog', { name: 'Study' });
}

// The rows API the session's real store talks to: GET answers `saved` (after `rowsGate`, when set),
// PUT stores the body or throws `putError`.
let rowsGate: Promise<void> | null;
let putError: unknown;
// POST /api/study/eligibility: the companion kinds of each asked entry (default: every kind).
let eligible: (id: number) => string[];

beforeEach(() => {
	saved = defaultSetup();
	rowsGate = null;
	putError = null;
	eligible = () => ['sentence', 'writing', 'tone', 'reverse', 'cloze'];
	const row = () => ({ key: 'study-setup', userId: 1, workspaceId: 1, data: saved, version: 1, updatedAt: '2026-11-25T00:00:00Z', deletedAt: null });
	ctx = testContext({
		routes: {
			'GET /api/rows': async () => {
				if (rowsGate !== null) await rowsGate;
				return [row()];
			},
			'POST /api/study/eligibility': (body: unknown) => ({
				entries: Object.fromEntries((body as { ids: number[] }).ids.map((id) => [String(id), eligible(id)]))
			}),
			'PUT /api/rows/study-setup': (body: unknown) => {
				if (putError !== null) throw putError;
				saved = body as StudySetup;
				return row();
			}
		}
	});
	workspace('ja');
	update = vi.spyOn(StudySetups.prototype, 'update');
	vi.mocked(loadStudyHistory).mockResolvedValue(build.history({ decks: [DECK], cards: [vocab(1), vocab(2, ['d1'])] }));
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	sessionStorage.clear();
	localStorage.clear();
});

describe('the study modal', () => {
	it('is a dialog titled Study with the summary, this session, the chips and focus on Start', async () => {
		const dialog = await open();
		await waitFor(() => expect(dialog.textContent).toContain('0 due · 2 new · 2 decks'));
		expect(dialog.textContent).toContain('This session: 2 cards');
		const start = within(dialog).getByRole('button', { name: 'Start studying' });
		await waitFor(() => expect(document.activeElement).toBe(start));
		expect(within(dialog).getByRole('checkbox', { name: 'Vocab' })).toBeTruthy();
		expect(within(dialog).getByRole('button', { name: 'Study all' })).toBeTruthy();
		expect(within(dialog).getByRole('link', { name: /Advanced settings/ }).getAttribute('href')).toBe(
			`/study/advanced?from=${encodeURIComponent(location.pathname)}`
		);
	});

	it('is the bottom sheet on the phone, still titled', async () => {
		vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }));
		const sheet = await open();
		expect(sheet.className).toContain('sheet');
		expect(within(sheet).getByRole('heading', { name: 'Study' })).toBeTruthy();
	});

	it('shows only the kinds the language offers', async () => {
		workspace('es');
		const dialog = await open();
		await within(dialog).findByRole('checkbox', { name: 'Vocab' });
		expect(within(dialog).queryByRole('checkbox', { name: 'Writing' })).toBeNull();
		expect(within(dialog).queryByRole('checkbox', { name: 'Tone' })).toBeNull();
	});

	it('shows Reverse only when a selected deck switches it on', async () => {
		const dialog = await open();
		await waitFor(() => expect(dialog.textContent).toContain('2 decks'));
		expect(within(dialog).queryByRole('checkbox', { name: 'Reverse' })).toBeNull();
		cleanup();
		vi.mocked(loadStudyHistory).mockResolvedValue(
			build.history({ decks: [DECK], cards: [vocab(1, ['d1'])], deckSettings: { d1: { deckId: 'd1', cardTypes: ['reverse'], extra: {} } } })
		);
		const again = await open();
		expect(((await within(again).findByRole('checkbox', { name: 'Reverse' })) as HTMLInputElement).checked).toBe(true);
	});

	it('the last chip stays selected', async () => {
		const dialog = await open();
		const vocabChip = (await within(dialog).findByRole('checkbox', { name: 'Vocab' })) as HTMLInputElement;
		expect(vocabChip.checked).toBe(true);
		expect(vocabChip.disabled).toBe(true);
	});

	it('a chip saves the setup at once, for the workspace it was clicked in', async () => {
		const dialog = await open();
		await fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'Writing' }));
		expect(update).toHaveBeenCalledWith(1, { cardTypes: ['vocab', 'writing'] });
		await waitFor(() => expect(saved.cardTypes).toEqual(['vocab', 'writing']));
	});

	it('on a cold start the chips wait for the saved setup; a chip then keeps the synced members (review blocker)', async () => {
		let release!: () => void;
		rowsGate = new Promise<void>((r) => (release = r));
		saved = { ...defaultSetup(), decks: ['d1'], newLimit: 7, typeOrder: 'grouped' };
		const dialog = await open();
		const writing = (await within(dialog).findByRole('checkbox', { name: 'Writing' })) as HTMLInputElement;
		expect(writing.disabled).toBe(true);
		release();
		await waitFor(() => expect(writing.disabled).toBe(false));
		await fireEvent.click(writing);
		await waitFor(() => expect(saved).toMatchObject({ decks: ['d1'], newLimit: 7, typeOrder: 'grouped', cardTypes: ['vocab', 'writing'] }));
	});

	it('opening it writes nothing, even when it repaired the saved setup, and says what it fell back to', async () => {
		saved = { ...defaultSetup(), decks: ['gone'] };
		const dialog = await open();
		await waitFor(() => expect(dialog.textContent).toContain('The decks you chose are gone; studying all decks.'));
		expect(update).not.toHaveBeenCalled();
	});

	it('Start writes the running session from the saved setup and goes to the session, closing the modal', async () => {
		saved = { ...defaultSetup(), newLimit: 7 };
		const dialog = await open();
		const start = within(dialog).getByRole('button', { name: 'Start studying' });
		await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(start);
		const config = JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY)!);
		expect(config).toMatchObject({ mode: 'decks', deckIds: ['general', 'd1'], newLimit: 7, cardTypes: ['vocab'], from: location.pathname });
		expect(config.studyAll).toBeUndefined();
		expect(Number.isInteger(config.seed)).toBe(true);
		expect(goto).toHaveBeenCalledWith('/study/session');
		expect(ctx.session.studyModal.open).toBe(false);
		expect(update).not.toHaveBeenCalled();
	});

	it('Study all marks the session', async () => {
		const dialog = await open();
		const all = within(dialog).getByRole('button', { name: 'Study all' });
		await waitFor(() => expect((all as HTMLButtonElement).disabled).toBe(false));
		await fireEvent.click(all);
		expect(JSON.parse(sessionStorage.getItem(SESSION_CONFIG_KEY)!).studyAll).toBe(true);
	});

	it('with nothing to study it says so and Start is disabled', async () => {
		eligible = () => [];
		const reviewed = build.review({ cardId: 'c-vocab-1', ts: new Date().toISOString(), grade: 4 });
		vi.mocked(loadStudyHistory).mockResolvedValue(build.history({ decks: [], cards: [vocab(1)], reviews: [reviewed] }));
		const dialog = await open();
		await waitFor(() => expect(dialog.textContent).toContain('Nothing is due and no new cards are left in the selected decks.'));
		expect((within(dialog).getByRole('button', { name: 'Start studying' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('a vacation day replaces both lines with the vacation note', async () => {
		const today = studyDay([]).today();
		vi.mocked(loadStudyHistory).mockResolvedValue(
			build.history({
				cards: [vocab(1)],
				vacations: [{ version: 1, id: 'V', start: today, end: null, scope: 'all', createdDay: today, createdAt: `${today}T00:00:00Z` }]
			})
		);
		const dialog = await open();
		await waitFor(() => expect(dialog.textContent).toMatch(/On vacation|Vacation/));
		expect(dialog.textContent).not.toContain('This session');
		expect(within(dialog).getByRole('link', { name: 'Change' }).getAttribute('href')).toBe('/settings?tab=study');
	});

	it('an unsaved change says so: offline it is kept, a refusal says why (record 0001)', async () => {
		putError = new TypeError('Failed to fetch');
		const dialog = await open();
		await fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'Writing' }));
		expect(await within(dialog).findByText(/^Not saved yet/)).toBeTruthy();
		putError = new ApiError(413, JSON.stringify({ error: 'too_large', message: 'x' }));
		await fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Word Salad' }));
		// A refusal drops the change and shows the error's own text, not the offline line.
		await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe(t('apiError.tooLarge')));
		expect((within(dialog).getByRole('checkbox', { name: 'Word Salad' }) as HTMLInputElement).checked).toBe(false);
	});

	it('a level setup sums up the scheme and level', async () => {
		const scheme = { id: 3, name: 'JLPT', unit: 'word', language: 'ja', levels: [{ id: 1, ord: 1, name: 'N5' }] } as Scheme;
		vi.mocked(getSchemes).mockResolvedValue([scheme]);
		saved = { ...defaultSetup(), mode: 'levels', schemeId: 3, levelName: 'N5' };
		const dialog = await open();
		await waitFor(() => expect(dialog.textContent).toContain('JLPT N5 ·'));
	});

	it('a failed scheme read keeps a level setup a level setup (review)', async () => {
		vi.mocked(getSchemes).mockRejectedValue(new Error('down'));
		saved = { ...defaultSetup(), mode: 'levels', schemeId: 3, levelName: 'N5' };
		const dialog = await open();
		await waitFor(() => expect(dialog.textContent).toContain('Could not load level schemes.'));
		expect(dialog.textContent).not.toContain('Your level is no longer installed');
		expect((within(dialog).getByRole('button', { name: 'Start studying' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('hides a card type with nothing to study and says why; it comes back with its cards (#289)', async () => {
		saved = { ...defaultSetup(), cardTypes: ['vocab', 'sentence'] };
		eligible = (id) => (id === 1 ? ['writing'] : ['writing', 'reverse']);
		const dialog = await open();
		await waitFor(() => expect(dialog.textContent).toContain('Word Salad: no example sentences for these words yet.'));
		expect(within(dialog).queryByRole('checkbox', { name: 'Word Salad' })).toBeNull();
		expect(within(dialog).getByRole('checkbox', { name: 'Writing' })).toBeTruthy();
		// Vocab is the last visible selected chip: locked, and the hidden choice is kept.
		expect((within(dialog).getByRole('checkbox', { name: 'Vocab' }) as HTMLInputElement).disabled).toBe(true);
		expect(dialog.textContent).toContain('This session: 2 cards');
		expect(update).not.toHaveBeenCalled();

		// A sentence arrives for 学校: the type is offered again, still checked.
		cleanup();
		ctx.session.studyModal.hide();
		eligible = (id) => (id === 1 ? ['sentence', 'writing'] : ['writing']);
		ctx.session.eligibility.forget(1);
		const again = await open();
		const salad = (await within(again).findByRole('checkbox', { name: 'Word Salad' })) as HTMLInputElement;
		expect(salad.checked).toBe(true);
		await waitFor(() => expect(again.textContent).toContain('This session: 3 cards'));
		expect(again.textContent).not.toContain('no example sentences');
	});

	it('a deck selection with nothing at all to study shows no chips and the empty state', async () => {
		eligible = () => [];
		const reviewed = [1, 2].map((n) => build.review({ cardId: `c-vocab-${n}`, ts: new Date().toISOString(), grade: 4 }));
		vi.mocked(loadStudyHistory).mockResolvedValue(build.history({ decks: [DECK], cards: [vocab(1), vocab(2, ['d1'])], reviews: reviewed }));
		const dialog = await open();
		await waitFor(() => expect(dialog.textContent).toContain('Nothing is due and no new cards are left in the selected decks.'));
		expect(within(dialog).queryAllByRole('checkbox')).toEqual([]);
	});

	it('Escape closes it', async () => {
		const dialog = await open();
		await fireEvent.keyDown(dialog, { key: 'Escape' });
		expect(ctx.session.studyModal.open).toBe(false);
	});
});
