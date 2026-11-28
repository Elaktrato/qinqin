// The conjugation drill in the Practice area (#178): its items from the learner's studied words and the server's
// forms, a recognise question, a typed produce question (Enter during IME composition never checks; the field
// keeps its focus after the answer and Enter moves on), the choice fallback (Hard), hidden romaji, and the
// drill.conjugation events through the outbox.
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyHistory: vi.fn()
}));

import type { StudyEventBody, Workspace } from '$lib/api/types';
import { loadStudyHistory } from '$lib/studycore/data';
import { drillAnswersOf } from '$lib/studycore/drills';
import type { StudyEvent } from '$lib/events';
import PracticePage from '../PracticePage.svelte';

const NOW = Date.parse('2026-11-28T12:00:00Z');
const a = (written: string, reading: string, romaji: string) => ({ written, reading, romaji });
const TABERU = {
	id: 7,
	class: 'v1',
	written: '食べる',
	reading: 'たべる',
	readings: [
		{ type: 'kana', value: 'たべる' },
		{ type: 'romaji', value: 'taberu' }
	],
	families: ['polite', 'polite-past', 'negative', 'past', 'te-form', 'potential', 'passive'],
	forms: {
		polite: [a('食べます', 'たべます', 'tabemasu')],
		'polite-negative': [a('食べません', 'たべません', 'tabemasen')],
		'polite-volitional': [a('食べましょう', 'たべましょう', 'tabemashou')],
		'polite-past': [a('食べました', 'たべました', 'tabemashita')],
		'polite-past-negative': [a('食べませんでした', 'たべませんでした', 'tabemasendeshita')],
		negative: [a('食べない', 'たべない', 'tabenai')],
		past: [a('食べた', 'たべた', 'tabeta')],
		'past-negative': [a('食べなかった', 'たべなかった', 'tabenakatta')],
		te: [a('食べて', 'たべて', 'tabete')],
		potential: [a('食べられる', 'たべられる', 'taberareru'), a('食べれる', 'たべれる', 'tabereru')],
		passive: [a('食べられる', 'たべられる', 'taberareru')]
	}
};

let ctx: TestContext = testContext();
let recorded: StudyEventBody[] = [];

function answer(n: number, item: string, grade: number): StudyEvent {
	return {
		id: `01KB0000000000000000000${String(n).padStart(3, '0')}`,
		workspaceId: 1,
		device: 'web',
		ts: new Date(NOW - (60 - n) * 86_400_000).toISOString(),
		type: 'drill.conjugation',
		payload: { item, mode: 'recognise', grade }
	};
}

function history(events: StudyEvent[] = []) {
	return {
		decks: [],
		cards: [{ id: 'c7', kind: 'vocab', entryId: 7, deckIds: ['d'], createdAt: '2026-11-01T00:00:00Z' }],
		reviews: [{ id: 'r1', workspaceId: 1, ts: '2026-11-02T00:00:00Z', type: 'review', payload: { cardId: 'c7', mode: 'vocab', grade: 3 } }],
		merged: 0,
		grammarRuns: [],
		courseEvents: [],
		drillAnswers: drillAnswersOf(1, events)
	};
}

function open(settings: Record<string, unknown> = {}, events: StudyEvent[] = []) {
	ctx = testContext({ routes: { 'POST /api/drills/conjugation/words': { words: [TABERU] } } });
	const ws = { id: 1, language: 'ja', name: 'ja', settings, updatedAt: 't' } as Workspace;
	ctx.session.workspaces.set({ list: [ws], current: ws });
	vi.mocked(loadStudyHistory).mockResolvedValue(history(events) as never);
	vi.spyOn(ctx.session.outbox, 'recordEvent').mockImplementation(async (event) => {
		recorded.push(event);
		return event;
	});
}

const show = (rest: string) => render(PracticePage, { props: { rest }, context: ctx.context });

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	recorded = [];
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('the conjugation drill', () => {
	it('is listed for Japanese with one item per word and family switched on', async () => {
		open();
		show('');
		expect(await screen.findByRole('heading', { level: 2, name: 'Conjugation' })).toBeTruthy();
		// The five beginner families of 食べる.
		expect(screen.getByText('5 new')).toBeTruthy();
	});

	it('asks a new item to be recognised; a right form name is Good', async () => {
		open({ conjugation: { families: { polite: false, 'polite-past': false, negative: false, past: false, potential: true } } });
		show('conjugation');
		expect(await screen.findByText('Which form is this?')).toBeTruthy();
		expect(screen.getByText('食べる')).toBeTruthy();
		expect(screen.getByText('taberu')).toBeTruthy();
		// て-form first (family order), then the potential.
		expect(screen.getByText('食べて')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'て-form (〜て / 〜で)' }));
		expect((await screen.findByRole('status')).textContent).toContain('Right.');
		await waitFor(() => expect(recorded).toHaveLength(1));
		expect(recorded[0].type).toBe('drill.conjugation');
		expect(recorded[0].payload).toEqual({ item: '7:te-form', mode: 'recognise', grade: 3 });

		// 食べられる is the potential and the passive: the passive is not offered as a wrong choice.
		await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		expect(await screen.findByText('食べられる')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'passive (〜れる / 〜られる)' })).toBeNull();
	});

	it('produce: Enter while composing never checks; a typed right answer is Good, the field keeps its focus', async () => {
		open({ conjugation: { families: { polite: false, negative: false, past: false, 'te-form': false } } }, [answer(1, '7:polite-past', 3)]);
		show('conjugation');
		const field = (await screen.findByLabelText('Your answer')) as HTMLInputElement;
		expect(screen.getByText('polite past negative (〜ませんでした / 〜なかったです)')).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(field));
		await fireEvent.compositionStart(field);
		await fireEvent.input(field, { target: { value: 'たべませんでした' } });
		await fireEvent.keyDown(field, { key: 'Enter', keyCode: 229, isComposing: true });
		await fireEvent.compositionEnd(field);
		expect(recorded).toHaveLength(0);
		await fireEvent.input(field, { target: { value: '食べませんでした' } });
		await fireEvent.keyDown(field, { key: 'Enter', keyCode: 13 });
		expect((await screen.findByRole('status')).textContent).toContain('Right.');
		await waitFor(() => expect(recorded).toHaveLength(1));
		expect(recorded[0].payload).toEqual({ item: '7:polite-past', mode: 'produce', grade: 3 });
		expect(document.activeElement).toBe(field);
		expect(field.readOnly).toBe(true);
		// Enter in the field moves on (the round's end: one item).
		await fireEvent.keyDown(field, { key: 'Enter', keyCode: 13 });
		expect(await screen.findByRole('heading', { name: 'Round done' })).toBeTruthy();
	});

	it('produce: an accepted answer says the standard form; the choices are a right answer after a hint (Hard)', async () => {
		open({ conjugation: { families: { polite: false, 'polite-past': false, negative: false, past: false, 'te-form': false, potential: true } } }, [
			answer(1, '7:potential', 3)
		]);
		show('conjugation');
		const field = (await screen.findByLabelText('Your answer')) as HTMLInputElement;
		await fireEvent.input(field, { target: { value: 'タベレル' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Check' }));
		expect((await screen.findByRole('status')).textContent).toContain('The standard form is 食べられる【たべられる】.');
		await waitFor(() => expect(recorded[0]?.payload).toEqual({ item: '7:potential', mode: 'produce', grade: 3 }));

		cleanup();
		recorded = [];
		open({ conjugation: { families: { polite: false, 'polite-past': false, negative: false, past: false, 'te-form': false, potential: true } } }, [
			answer(1, '7:potential', 3)
		]);
		show('conjugation');
		await fireEvent.click(await screen.findByRole('button', { name: 'Show choices' }));
		const choices = screen.getByRole('group', { name: 'Choose the form' });
		expect(choices.querySelectorAll('button')).toHaveLength(4);
		await fireEvent.click(screen.getByRole('button', { name: '食べられる' }));
		await waitFor(() => expect(recorded[0]?.payload).toEqual({ item: '7:potential', mode: 'produce', grade: 2 }));
	});

	it('a wrong typed answer is Again and shows the answer; hidden romaji stays hidden', async () => {
		open({ romanisation: { romaji: 'never' }, conjugation: { families: { polite: false, 'polite-past': false, negative: false, 'te-form': false } } }, [
			answer(1, '7:past', 3)
		]);
		show('conjugation');
		const field = (await screen.findByLabelText('Your answer')) as HTMLInputElement;
		expect(screen.queryByText('taberu')).toBeNull();
		await fireEvent.input(field, { target: { value: 'たべた' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Check' }));
		const status = await screen.findByRole('status');
		expect(status.textContent).toContain('Not quite. The answer is 食べなかった【たべなかった】.');
		expect(status.textContent).not.toContain('tabenakatta');
		await waitFor(() => expect(recorded[0]?.payload).toEqual({ item: '7:past', mode: 'produce', grade: 1 }));
	});

	it('has no items with every family off', async () => {
		open({ conjugation: { families: { polite: false, 'polite-past': false, negative: false, past: false, 'te-form': false } } });
		show('');
		expect(await screen.findByRole('heading', { level: 2, name: 'Conjugation' })).toBeTruthy();
		expect(screen.getByText('Nothing to practise in this drill yet.')).toBeTruthy();
	});
});
