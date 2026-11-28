// The measure-word and counter drills in the Practice area (#179): Chinese measure words from the server's nouns, a
// typed answer (Enter during IME composition never checks; the field keeps its focus and Enter moves on), 个 as the
// fallback (Hard), the choices (Hard), hidden pinyin; Japanese counters and the counter readings (kanji from the IME
// is not graded), hidden romaji; the drill.* events through the outbox.
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyHistory: vi.fn()
}));
// The tone-pair drill (Chinese) reads the level lists and the entry bases; none here.
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(async () => []), getSchemeEntries: vi.fn(async () => []) }));
vi.mock('$lib/api/entryBases', () => ({ loadEntryBases: vi.fn(async () => new Map()) }));

import type { StudyEventBody, Workspace } from '$lib/api/types';
import { loadStudyHistory } from '$lib/studycore/data';
import { drillAnswersOf } from '$lib/studycore/drills';
import words from '../../../../../../../docs/contracts/counters/words.json';
import readings from '../../../../../../../docs/contracts/counters/readings.json';
import PracticePage from '../PracticePage.svelte';

const NOW = Date.parse('2026-11-28T12:00:00Z');
// The fixture's nouns by key, with ids: 书 1, 猫 2, 人 3 (Chinese), 紙 11, 本 12 (Japanese).
const IDS: Record<string, number> = { 'zh:书': 1, 'zh:猫': 2, 'zh:人': 3, 'ja:紙': 11, 'ja:本': 12, 'ja:水': 13 };
const answer = {
	words: words.words.map(({ key, ...w }) => ({ ...w, id: IDS[key] })),
	pools: words.pools
};

let ctx: TestContext = testContext();
let recorded: StudyEventBody[] = [];

function history(ids: number[]) {
	return {
		decks: [],
		cards: ids.map((id) => ({ id: `c${id}`, kind: 'vocab', entryId: id, deckIds: ['d'], createdAt: '2026-11-01T00:00:00Z', ...(id < 10 ? { entryKind: 'character' } : {}) })),
		reviews: ids.map((id, i) => ({ id: `r${id}`, workspaceId: 1, ts: `2026-11-0${i + 2}T00:00:00Z`, type: 'review', payload: { cardId: `c${id}`, mode: 'vocab', grade: 3 } })),
		merged: 0,
		grammarRuns: [],
		courseEvents: [],
		drillAnswers: drillAnswersOf(1, [])
	};
}

function open(language: string, ids: number[], settings: Record<string, unknown> = {}) {
	ctx = testContext({
		routes: {
			'POST /api/drills/measure-words/words': answer,
			'GET /api/drills/counters': readings,
			// The conjugation drill (Japanese): no verbs here.
			'POST /api/drills/conjugation/words': { words: [] }
		}
	});
	const ws = { id: 1, language, name: language, settings, updatedAt: 't' } as Workspace;
	ctx.session.workspaces.set({ list: [ws], current: ws });
	vi.mocked(loadStudyHistory).mockResolvedValue(history(ids) as never);
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

describe('the measure-word drill (Chinese)', () => {
	it('is listed for Chinese with one item per studied noun that has a measure word', async () => {
		open('zh', [1, 2, 3]);
		show('');
		expect(await screen.findByRole('heading', { level: 2, name: 'Measure words' })).toBeTruthy();
		expect(screen.getByText('3 new')).toBeTruthy();
		expect(screen.queryByRole('heading', { level: 2, name: 'Counters' })).toBeNull();
	});

	it('typed: Enter while composing never checks; a right answer is Good and the field keeps its focus', async () => {
		open('zh', [1]);
		show('measure-words');
		const field = (await screen.findByLabelText('Measure word')) as HTMLInputElement;
		expect(screen.getByText('book')).toBeTruthy();
		expect(screen.getByText('shū')).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(field));
		await fireEvent.compositionStart(field);
		await fireEvent.input(field, { target: { value: 'ben' } });
		await fireEvent.keyDown(field, { key: 'Enter', keyCode: 229, isComposing: true });
		await fireEvent.compositionEnd(field);
		expect(recorded).toHaveLength(0);
		await fireEvent.input(field, { target: { value: '本' } });
		await fireEvent.keyDown(field, { key: 'Enter', keyCode: 13 });
		const status = await screen.findByRole('status');
		expect(status.textContent).toContain('Right: 本 (běn).');
		expect(status.textContent).toContain('一本书');
		expect(status.textContent).toContain('Also right: 册, 部.');
		await waitFor(() => expect(recorded).toHaveLength(1));
		expect(recorded[0].type).toBe('drill.measure-words');
		expect(recorded[0].payload).toEqual({ item: '1', mode: 'produce', grade: 3 });
		expect(document.activeElement).toBe(field);
		expect(field.readOnly).toBe(true);
		await fireEvent.keyDown(field, { key: 'Enter', keyCode: 13 });
		expect(await screen.findByRole('heading', { name: 'Round done' })).toBeTruthy();
	});

	it('个 is the fallback: right but Hard, with the standard word; hidden pinyin stays hidden', async () => {
		open('zh', [2], { romanisation: { pinyin: 'never', bopomofo: 'never' } });
		show('measure-words');
		const field = (await screen.findByLabelText('Measure word')) as HTMLInputElement;
		expect(screen.queryByText('māo')).toBeNull();
		await fireEvent.input(field, { target: { value: '个' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Check' }));
		const status = await screen.findByRole('status');
		expect(status.textContent).toContain('个 is understood and common in speech, but 只 is the standard word.');
		expect(status.textContent).not.toContain('zhī');
		await waitFor(() => expect(recorded[0]?.payload).toEqual({ item: '2', mode: 'produce', grade: 2 }));
	});

	it('an empty answer is not graded; the choices are a right answer after a hint (Hard)', async () => {
		open('zh', [1]);
		show('measure-words');
		await screen.findByLabelText('Measure word');
		await fireEvent.click(screen.getByRole('button', { name: 'Check' }));
		expect((await screen.findByRole('alert')).textContent).toBe('Type a measure word first.');
		expect(recorded).toHaveLength(0);
		await fireEvent.click(screen.getByRole('button', { name: 'Show choices' }));
		const choices = screen.getByRole('group', { name: 'Choose the measure word' });
		expect(choices.querySelectorAll('button')).toHaveLength(4);
		await fireEvent.click(screen.getByRole('button', { name: '本' }));
		await waitFor(() => expect(recorded[0]?.payload).toEqual({ item: '1', mode: 'choose', grade: 2 }));
	});

	it('a wrong answer is Again and shows the answer', async () => {
		open('zh', [1]);
		show('measure-words');
		const field = (await screen.findByLabelText('Measure word')) as HTMLInputElement;
		await fireEvent.input(field, { target: { value: '张' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Check' }));
		expect((await screen.findByRole('status')).textContent).toContain('Not quite. The answer is 本 (běn).');
		await waitFor(() => expect(recorded[0]?.payload).toEqual({ item: '1', mode: 'produce', grade: 1 }));
	});
});

describe('the counter drills (Japanese)', () => {
	it('lists Counters and Counter readings for Japanese', async () => {
		open('ja', [11, 12]);
		show('');
		expect(await screen.findByRole('heading', { level: 2, name: 'Counters' })).toBeTruthy();
		expect(screen.getByRole('heading', { level: 2, name: 'Counter readings' })).toBeTruthy();
		expect(screen.queryByRole('heading', { level: 2, name: 'Measure words' })).toBeNull();
	});

	it('counters: a counter typed in kana is right; what it counts is shown', async () => {
		open('ja', [12]);
		show('counters');
		const field = (await screen.findByLabelText('Counter')) as HTMLInputElement;
		expect(screen.getByText('本')).toBeTruthy();
		expect(screen.getByText('ほん')).toBeTruthy();
		await fireEvent.input(field, { target: { value: 'さつ' } });
		await fireEvent.keyDown(field, { key: 'Enter', keyCode: 13 });
		const status = await screen.findByRole('status');
		expect(status.textContent).toContain('Right: 冊【さつ】.');
		expect(status.textContent).toContain('Counts books');
		await waitFor(() => expect(recorded[0]?.payload).toEqual({ item: '12', mode: 'produce', grade: 3 }));
		expect(recorded[0].type).toBe('drill.counters');
	});

	it('readings: kanji from the IME is not graded; the kana reading is Good; hidden romaji stays hidden', async () => {
		open('ja', [], { romanisation: { romaji: 'never' } });
		show('counter-readings');
		const field = (await screen.findByLabelText('Reading')) as HTMLInputElement;
		const first = readings.counters[0].numbers[0];
		expect(screen.getByText(first.prompt)).toBeTruthy();
		await fireEvent.input(field, { target: { value: '一つ' } });
		await fireEvent.keyDown(field, { key: 'Enter', keyCode: 13 });
		expect((await screen.findByRole('alert')).textContent).toContain('Type the reading in kana or romaji');
		expect(recorded).toHaveLength(0);
		await fireEvent.input(field, { target: { value: first.answers[0].reading } });
		await fireEvent.keyDown(field, { key: 'Enter', keyCode: 13 });
		const status = await screen.findByRole('status');
		expect(status.textContent).toContain(`Right: ${first.written}【${first.answers[0].reading}】.`);
		expect(status.textContent).not.toContain(first.answers[0].romaji);
		await waitFor(() => expect(recorded[0]?.payload).toEqual({ item: `${readings.counters[0].id}:${first.number}`, mode: 'produce', grade: 3 }));
		expect(recorded[0].type).toBe('drill.counter-readings');
		expect(document.activeElement).toBe(field);
	});

	it('readings: the choices hold the common mistakes; a right choice is Hard', async () => {
		open('ja', []);
		show('counter-readings');
		await screen.findByLabelText('Reading');
		await fireEvent.click(screen.getByRole('button', { name: 'Show choices' }));
		const first = readings.counters[0].numbers[0];
		await fireEvent.click(screen.getByRole('button', { name: first.answers[0].reading }));
		await waitFor(() => expect(recorded[0]?.payload).toEqual({ item: `${readings.counters[0].id}:${first.number}`, mode: 'choose', grade: 2 }));
		expect((await screen.findByRole('status')).textContent).toContain(first.answers[0].romaji);
	});
});
