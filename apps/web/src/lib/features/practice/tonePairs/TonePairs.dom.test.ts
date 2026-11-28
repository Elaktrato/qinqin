// The tone-pair drill (#180) in the Practice area of a Chinese workspace: the grid on the list, a round answered by
// typing (the field keeps the focus across items) and by the tone buttons, the verdict with tone sandhi, the
// workspace's tone settings and hidden pinyin.
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyHistory: vi.fn()
}));
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(), getSchemeEntries: vi.fn() }));
vi.mock('$lib/api/entryBases', () => ({ loadEntryBases: vi.fn() }));
vi.mock('$lib/api/audio', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/audio')>()),
	getEntryAudio: vi.fn(async () => ({ terms: [], syllables: null }))
}));

import type { EntryBase, StudyEventBody } from '$lib/api/types';
import { getSchemeEntries, getSchemes } from '$lib/api/schemes';
import { loadEntryBases } from '$lib/api/entryBases';
import { loadStudyHistory } from '$lib/studycore/data';
import { drillAnswersOf } from '$lib/studycore/drills';
import type { StudyEvent } from '$lib/events';
import PracticePage from '../PracticePage.svelte';

const NOW = Date.parse('2026-11-28T12:00:00Z');
let ctx: TestContext = testContext();
let recorded: StudyEventBody[] = [];

const base = (id: number, written: string, pinyin: string): EntryBase => ({
	id,
	language: 'zh',
	kind: 'word',
	written,
	readings: [{ type: 'pinyin', value: pinyin, plain: '', ord: 0 }],
	attrs: {},
	radicalId: null
});
// Level 1 of the word list: 你好 (3-3), 学习 (2-2), 中国 (1-2), 不是 (4-4).
const LEVEL = [base(1, '你好', 'nǐ hǎo'), base(2, '学习', 'xué xí'), base(3, '中国', 'zhōng guó'), base(4, '不是', 'bù shì')];

function answer(n: number, item: string, grade: number, minutesAgo: number): StudyEvent {
	return {
		id: `01KB0000000000000000000${String(n).padStart(3, '0')}`,
		workspaceId: 1,
		device: 'web',
		ts: new Date(NOW - minutesAgo * 60_000).toISOString(),
		type: 'drill.tone-pairs',
		payload: { item, mode: 'mark', grade }
	};
}

function history(events: StudyEvent[] = []) {
	return { decks: [], cards: [], reviews: [], merged: 0, grammarRuns: [], courseEvents: [], drillAnswers: drillAnswersOf(1, events) };
}

function workspace(settings: Record<string, unknown> = {}): void {
	ctx.session.workspaces.set({ list: [], current: { id: 1, language: 'zh', name: 'zh', settings } as never });
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	// The measure-word drill (#179) applies to Chinese, the counter drills to Japanese: nothing to count here.
	ctx = testContext({
		routes: {
			'POST /api/drills/measure-words/words': { words: [], pools: {} },
			'GET /api/drills/counters': { counters: [] },
			'POST /api/drills/conjugation/words': { words: [] }
		}
	});
	recorded = [];
	workspace();
	vi.mocked(loadStudyHistory).mockResolvedValue(history());
	vi.mocked(loadEntryBases).mockResolvedValue(new Map());
	vi.mocked(getSchemes).mockResolvedValue([
		{ id: 9, name: 'HSK words', unit: 'word', language: 'zh', packId: 'hsk-words', levels: [{ id: 91, ord: 1, name: 'HSK 1' }] }
	]);
	vi.mocked(getSchemeEntries).mockResolvedValue(LEVEL);
	vi.spyOn(ctx.session.outbox, 'recordEvent').mockImplementation(async (event) => {
		recorded.push(event);
		return event;
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

const show = (rest: string) => render(PracticePage, { props: { rest }, context: ctx.context });
const field = () => screen.getByLabelText('Tones') as HTMLInputElement;

describe('the tone-pair grid on the Practice list', () => {
	it('shows the 20 pairs, the ones with words and none weak before an answer', async () => {
		show('');
		expect(await screen.findByRole('heading', { level: 2, name: 'Tone pairs' })).toBeTruthy();
		expect(screen.getByText('4 new')).toBeTruthy();
		const grid = screen.getByRole('region', { name: 'Your tone pairs' });
		expect(grid.querySelectorAll('[data-pair]')).toHaveLength(20);
		expect(within(grid).getByLabelText('3-3: not practised yet')).toBeTruthy();
		expect(within(grid).getByLabelText('3-4: no words yet')).toBeTruthy();
		expect(within(grid).queryByRole('link', { name: 'Practise my weakest pairs' })).toBeNull();
	});

	it("shows each pair's accuracy and band, and offers its weakest round", async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue(
			history([answer(1, '3-3', 1, 60), answer(2, '3-3', 3, 50), answer(3, '3-3', 1, 40), answer(4, '2-2', 3, 30)])
		);
		show('');
		const grid = await screen.findByRole('region', { name: 'Your tone pairs' });
		expect(within(grid).getByLabelText('3-3: 33% right in the last 3 answers, weak')).toBeTruthy();
		expect(within(grid).getByLabelText('2-2: 100% right in the last answer, strong')).toBeTruthy();
		expect(grid.querySelector('[data-pair="3-3"]')!.classList.contains('band-weak')).toBe(true);
		expect(within(grid).getByRole('link', { name: 'Practise my weakest pairs' }).getAttribute('href')).toBe('/practice/tone-pairs/weakest');
	});

	it('is not offered in a Japanese workspace', async () => {
		ctx.session.workspaces.set({ list: [], current: { id: 1, language: 'ja', name: 'ja', settings: {} } as never });
		show('');
		// Japanese has the conjugation drill (#178), not this one.
		expect(await screen.findByRole('heading', { level: 2, name: 'Conjugation' })).toBeTruthy();
		expect(screen.queryByRole('heading', { level: 2, name: 'Tone pairs' })).toBeNull();
	});
});

describe('a tone-pair round', () => {
	it('is answered by typing: Enter checks, the field keeps the focus, Enter goes on to the next word', async () => {
		show('tone-pairs');
		expect(await screen.findByText('Question 1 of 4')).toBeTruthy();
		// Grid order: 1-2 中国 first.
		expect(screen.getByText('中国', { selector: '.written' })).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(field()));

		await fireEvent.input(field(), { target: { value: '1 2' } });
		await fireEvent.keyDown(field(), { key: 'Enter' });
		await waitFor(() => expect(recorded).toHaveLength(1));
		expect(recorded[0]).toMatchObject({ workspaceId: 1, type: 'drill.tone-pairs', payload: { item: '1-2', mode: 'mark', grade: 3 } });
		expect(screen.getByRole('status', { name: '' }).textContent).toContain('Right: 1-2.');
		expect(field().readOnly).toBe(true);
		expect(document.activeElement).toBe(field());

		await fireEvent.keyDown(field(), { key: 'Enter' });
		expect(await screen.findByText('Question 2 of 4')).toBeTruthy();
		expect(screen.getByText('学习', { selector: '.written' })).toBeTruthy();
		expect(field().value).toBe('');
		expect(field().readOnly).toBe(false);
		expect(document.activeElement).toBe(field());
	});

	it('says what to type when the answer is not two tones, and records nothing', async () => {
		show('tone-pairs');
		await screen.findByText('Question 1 of 4');
		await fireEvent.input(field(), { target: { value: '3' } });
		await fireEvent.keyDown(field(), { key: 'Enter' });
		expect((await screen.findByRole('alert')).textContent).toBe('Type two tones, such as 3 4.');
		expect(recorded).toHaveLength(0);
	});

	it('is answered with the tone buttons too, which fill the field', async () => {
		show('tone-pairs');
		await screen.findByText('Question 1 of 4');
		const second = screen.getByRole('group', { name: 'Tone of syllable 2' });
		await fireEvent.click(within(second).getByRole('button', { name: '2: second tone, rising' }));
		expect(field().value).toBe('? 2');
		const first = screen.getByRole('group', { name: 'Tone of syllable 1' });
		await fireEvent.click(within(first).getByRole('button', { name: '1: first tone, high level' }));
		expect(field().value).toBe('1 2');
		const check = screen.getByRole('button', { name: 'Check' });
		// A tap leaves the focus in the field (the phone keyboard stays up).
		expect(await fireEvent.pointerDown(check)).toBe(false);
		await fireEvent.click(check);
		await waitFor(() => expect(recorded).toHaveLength(1));
		expect(recorded[0].payload).toMatchObject({ item: '1-2', grade: 3 });
		expect(document.activeElement).toBe(field());
		// So does a tap on the round's Next.
		const next = screen.getByRole('button', { name: 'Next' });
		expect(await fireEvent.pointerDown(next)).toBe(false);
		await fireEvent.click(next);
		expect(await screen.findByText('Question 2 of 4')).toBeTruthy();
		expect(document.activeElement).toBe(field());
	});

	it('marks a wrong pair Again and shows the tones that were wanted', async () => {
		show('tone-pairs');
		await screen.findByText('Question 1 of 4');
		await fireEvent.input(field(), { target: { value: '4 4' } });
		await fireEvent.keyDown(field(), { key: 'Enter' });
		await waitFor(() => expect(recorded).toHaveLength(1));
		expect(recorded[0].payload).toMatchObject({ item: '1-2', grade: 1 });
		expect(screen.getByText('Not quite: the tones are 1-2.')).toBeTruthy();
		const answers = document.querySelectorAll('.answer');
		expect([...answers].map((a) => a.textContent?.trim())).toEqual(['zhōng', 'guó']);
	});
});

/** Answers the questions before 你好 (3-3, the third in grid order: 1-2, 2-2, 3-3, 4-4) right. */
async function toNiHao(): Promise<void> {
	for (const tones of ['1 2', '2 2']) {
		await fireEvent.input(field(), { target: { value: tones } });
		await fireEvent.keyDown(field(), { key: 'Enter' });
		await waitFor(() => expect(field().readOnly).toBe(true));
		await fireEvent.keyDown(field(), { key: 'Enter' });
	}
	expect(await screen.findByText('Question 3 of 4')).toBeTruthy();
}

describe('tone sandhi and the tone settings', () => {
	it('grades the citation tones, shows the spoken tone beside them', async () => {
		show('tone-pairs');
		await screen.findByText('Question 1 of 4');
		expect(screen.getByText('Mark the dictionary tones; a tone-sandhi tone also counts.')).toBeTruthy();
		await toNiHao();
		await fireEvent.input(field(), { target: { value: '3 3' } });
		await fireEvent.keyDown(field(), { key: 'Enter' });
		await waitFor(() => expect(recorded).toHaveLength(3));
		expect(recorded[2].payload).toMatchObject({ item: '3-3', grade: 3 });
		const first = document.querySelector('.answer')!;
		expect(first.getAttribute('data-answer-tone')).toBe('3');
		expect(first.getAttribute('data-spoken-tone')).toBe('2');
		expect(first.textContent).toContain('nǐ');
		expect(first.textContent).toContain('→ ní');
	});

	it('without "Show tone sandhi" only the citation tones show', async () => {
		workspace({ tones: { showSandhi: false } });
		show('tone-pairs');
		await screen.findByText('Question 1 of 4');
		await toNiHao();
		await fireEvent.input(field(), { target: { value: '2 3' } });
		await fireEvent.keyDown(field(), { key: 'Enter' });
		await waitFor(() => expect(recorded).toHaveLength(3));
		// The spoken tone is right by default.
		expect(recorded[2].payload).toMatchObject({ item: '3-3', grade: 3 });
		expect(document.querySelector('.answer')!.textContent).not.toContain('→');
	});

	it('with "Grade spoken tones" the citation tones of 你好 are wrong, its item stays 3-3', async () => {
		workspace({ tones: { gradeSpoken: true } });
		show('tone-pairs');
		await screen.findByText('Question 1 of 4');
		expect(screen.getByText('Mark the tones as spoken (with tone sandhi).')).toBeTruthy();
		await toNiHao();
		await fireEvent.input(field(), { target: { value: '3 3' } });
		await fireEvent.keyDown(field(), { key: 'Enter' });
		await waitFor(() => expect(recorded).toHaveLength(3));
		expect(recorded[2].payload).toMatchObject({ item: '3-3', grade: 1 });
		expect(screen.getByText('Not quite: the tones are 2-3.')).toBeTruthy();
	});

	it('with pinyin hidden the answer is tone numbers and contours, no pinyin letters', async () => {
		workspace({ romanisation: { pinyin: 'never' } });
		show('tone-pairs');
		await screen.findByText('Question 1 of 4');
		await toNiHao();
		await fireEvent.input(field(), { target: { value: '3 3' } });
		await fireEvent.keyDown(field(), { key: 'Enter' });
		await waitFor(() => expect(recorded).toHaveLength(3));
		const first = document.querySelector('.answer')!;
		expect(first.textContent).not.toMatch(/n[ǐí]/);
		expect(first.textContent).toContain('3ˇ');
		expect(first.textContent).toContain('→ 2ˊ');
		expect(first.querySelectorAll('svg.tone-contour')).toHaveLength(2);
		expect(document.body.textContent).not.toMatch(/nǐ|hǎo|zhōng|xué/);
	});
});
