// The look-alike drill in the Practice area (#228): a set joins once a member is studied (Japanese kana sets always),
// recognise (the character → its meaning) and choose (a word with a gap → the character) take turns, readings only
// through the romanisation settings, the answer lists every member with the strokes that make the difference drawn
// from the stroke data, and drill.look-alikes events carry the character asked and the one given.
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/studycore/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/studycore/data')>()),
	loadStudyHistory: vi.fn()
}));
// The tone-pair drill (Chinese) reads the level lists and the entry bases; none here.
vi.mock('$lib/api/schemes', () => ({ getSchemes: vi.fn(async () => []), getSchemeEntries: vi.fn(async () => []) }));
vi.mock('$lib/api/entryBases', () => ({ loadEntryBases: vi.fn(async () => new Map()) }));

import type { StudyEventBody, Workspace } from '$lib/api/types';
import type { StudyEvent } from '$lib/events';
import { loadStudyHistory } from '$lib/studycore/data';
import { drillAnswersOf } from '$lib/studycore/drills';
import PracticePage from '../PracticePage.svelte';

const NOW = Date.parse('2026-11-28T12:00:00Z');
let ctx: TestContext = testContext();
let recorded: StudyEventBody[] = [];

const answerEvent = (n: number, item: string): StudyEvent => ({
	id: `01KB0000000000000000000A0${n}`,
	workspaceId: 1,
	device: 'web',
	ts: `2026-11-2${n}T08:00:00Z`,
	type: 'drill.look-alikes',
	payload: { item, mode: 'recognise', grade: 3, asked: [...item][0], given: [...item][0] }
});

function history(written: string[], answers: StudyEvent[] = []) {
	return {
		decks: [],
		cards: written.map((w, i) => ({ id: `c${i}`, kind: 'vocab', entryId: i + 1, written: w, deckIds: ['d'], createdAt: '2026-11-01T00:00:00Z' })),
		reviews: written.map((_, i) => ({ id: `r${i}`, workspaceId: 1, ts: `2026-11-0${i + 2}T00:00:00Z`, type: 'review', payload: { cardId: `c${i}`, mode: 'vocab', grade: 3 } })),
		merged: 0,
		grammarRuns: [],
		courseEvents: [],
		drillAnswers: drillAnswersOf(1, answers)
	};
}

function open(language: string, written: string[], answers: StudyEvent[] = [], settings: Record<string, unknown> = {}) {
	ctx = testContext({
		routes: {
			// The other drills of the languages: nothing to practise there.
			'POST /api/drills/measure-words/words': { words: [], pools: {} },
			'GET /api/drills/counters': { counters: [] },
			'POST /api/drills/conjugation/words': { words: [] }
		}
	});
	const ws = { id: 1, language, name: language, settings, updatedAt: 't' } as Workspace;
	ctx.session.workspaces.set({ list: [ws], current: ws });
	vi.mocked(loadStudyHistory).mockResolvedValue(history(written, answers) as never);
	vi.spyOn(ctx.session.outbox, 'recordEvent').mockImplementation(async (event) => {
		recorded.push(event);
		return event;
	});
}

const show = (rest: string) => render(PracticePage, { props: { rest }, context: ctx.context });

/** Stroke data for /hanzi/: `count` strokes for 未 and 末, nothing else. */
function strokeServer(count: number) {
	const data = { strokes: Array.from({ length: count }, (_, i) => `M ${i} 0 L ${i} 10 Z`), medians: Array.from({ length: count }, () => [[0, 0], [10, 10]]) };
	return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		const url = String(input);
		if (url.startsWith('/hanzi/U672A.json') || url.startsWith('/hanzi/U672B.json')) return new Response(JSON.stringify(data), { status: 200 });
		return new Response('', { status: 404 });
	});
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	recorded = [];
	// The member asked: the first.
	vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('the look-alike drill on the Practice list', () => {
	it('lists the sets of the studied characters (Chinese)', async () => {
		open('zh', ['未来']);
		show('');
		const heading = await screen.findByRole('heading', { level: 2, name: 'Look-alike characters' });
		expect(within(heading.closest('li')!).getByText('1 new')).toBeTruthy();
	});

	it('has nothing to practise in Chinese before a character is studied', async () => {
		open('zh', []);
		show('');
		const heading = await screen.findByRole('heading', { level: 2, name: 'Look-alike characters' });
		expect(within(heading.closest('li')!).getByText('Nothing to practise in this drill yet.')).toBeTruthy();
	});

	it('always has the kana sets in Japanese', async () => {
		open('ja', []);
		show('');
		const heading = await screen.findByRole('heading', { level: 2, name: 'Look-alike characters' });
		expect(within(heading.closest('li')!).queryByText('Nothing to practise in this drill yet.')).toBeNull();
	});
});

describe('a look-alike round', () => {
	it('recognise: the character, its meaning among the set’s; a wrong answer is Again with what was given', async () => {
		strokeServer(5);
		open('zh', ['未来']);
		show('look-alikes');
		expect(await screen.findByText('What is this character?')).toBeTruthy();
		const shown = screen.getByText('未', { selector: 'p' });
		expect(shown.getAttribute('lang')).toBe('zh-Hans');
		const choices = screen.getByRole('group', { name: 'Choose its meaning' });
		expect(within(choices).getByText('wèi')).toBeTruthy();
		await fireEvent.click(within(choices).getByText('end; tip').closest('button')!);
		const status = await screen.findByRole('status');
		expect(status.textContent).toContain('Not quite: it is 未, not 末.');
		await waitFor(() => expect(recorded).toHaveLength(1));
		expect(recorded[0].type).toBe('drill.look-alikes');
		expect(JSON.stringify(recorded[0].payload)).toBe('{"item":"未末","mode":"recognise","grade":1,"asked":"未","given":"末"}');
		// The answer: every member with its note, the asked and the given one named; the marked strokes drawn.
		const members = screen.getByRole('list', { name: 'The characters of the set' });
		expect(within(members).getByText('asked')).toBeTruthy();
		expect(within(members).getByText('your answer')).toBeTruthy();
		expect(within(members).getByText('周末')).toBeTruthy();
		await waitFor(() => expect(members.querySelectorAll('svg path.marked').length).toBeGreaterThan(0));
		expect(members.querySelectorAll('svg').length).toBe(2);
	});

	it('choose: the word with a gap and no reading; the right character is Good', async () => {
		open('zh', ['未来'], [answerEvent(1, '未末')]);
		show('look-alikes');
		expect(await screen.findByText('Which character fills the gap?')).toBeTruthy();
		expect(screen.getByText('＿来')).toBeTruthy();
		expect(screen.getByText('future')).toBeTruthy();
		expect(screen.queryByText('wèi lái')).toBeNull();
		const choices = screen.getByRole('group', { name: 'Choose the character' });
		await fireEvent.click(within(choices).getByRole('button', { name: '未' }));
		expect((await screen.findByRole('status')).textContent).toContain('Right: 未.');
		await waitFor(() => expect(recorded).toHaveLength(1));
		expect(recorded[0].payload).toEqual({ item: '未末', mode: 'choose', grade: 3, asked: '未', given: '未' });
		// The reading shows on the answer.
		expect(screen.getByText('wèi lái')).toBeTruthy();
	});

	it('a traditional workspace asks the traditional word', async () => {
		open('zh-Hant', ['未來'], [answerEvent(1, '未末')]);
		show('look-alikes');
		expect(await screen.findByText('＿來')).toBeTruthy();
	});

	it('hidden pinyin and bopomofo stay hidden, in the choices and on the answer', async () => {
		open('zh', ['未来'], [], { romanisation: { pinyin: 'never', bopomofo: 'never' } });
		show('look-alikes');
		const choices = await screen.findByRole('group', { name: 'Choose its meaning' });
		expect(within(choices).queryByText('wèi')).toBeNull();
		await fireEvent.click(within(choices).getByText('not yet').closest('button')!);
		await screen.findByRole('status');
		expect(screen.queryByText(/wèi|mò|ㄨㄟ/)).toBeNull();
	});

	it('draws the font glyph when the stroke data has another stroke count', async () => {
		const fetch = strokeServer(4);
		open('zh', ['未来']);
		show('look-alikes');
		const choices = await screen.findByRole('group', { name: 'Choose its meaning' });
		await fireEvent.click(within(choices).getByText('not yet').closest('button')!);
		const members = await screen.findByRole('list', { name: 'The characters of the set' });
		await waitFor(() => expect(fetch).toHaveBeenCalled());
		expect(members.querySelectorAll('svg').length).toBe(0);
		expect(within(members).getAllByText('末').length).toBeGreaterThan(0);
	});

	it('kana: the same kana in the other script, romaji only where shown', async () => {
		open('ja', [], [], { romanisation: { romaji: 'never' } });
		show('look-alikes');
		const choices = await screen.findByRole('group', { name: 'Choose its meaning' });
		const shown = screen.getByText(/^[゠-ヿ]$/, { selector: 'p' });
		expect(shown.getAttribute('lang')).toBe('ja');
		expect(within(choices).getAllByRole('button').length).toBeGreaterThan(1);
		expect(within(choices).queryByText(/^[a-z]+$/)).toBeNull();
	});
});
