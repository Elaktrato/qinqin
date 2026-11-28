import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));

import { primaryActions } from '$lib/ui/testing/primary';
import { scriptPayload } from './events';
import { systemById } from './packs';
import ScriptsPage from './ScriptsPage.svelte';

let ctx: TestContext = testContext();
const workspace = (language: string) => ({ id: 7, language, name: '', settings: {}, updatedAt: '' }) as never;

function open(language: string, events: unknown[] = []) {
	const ws = workspace(language);
	ctx.session.workspaces.set({ list: [ws], current: ws });
	vi.spyOn(ctx.session.events, 'load').mockResolvedValue(events as never);
	const post = vi.spyOn(ctx.session.events, 'post').mockResolvedValue(undefined);
	return post;
}

const known = (item: string) =>
	[0, 1, 2].map((n) => ({
		id: `k${item}${n}`,
		workspaceId: 7,
		device: 'web',
		ts: new Date(Date.UTC(2026, 0, 1 + n * 3)).toISOString(),
		type: 'script',
		payload: scriptPayload('hiragana', item, 'recognise', true)
	}));

beforeEach(() => {
	ctx = testContext();
	try {
		localStorage.clear();
	} catch {
		// No storage in this environment.
	}
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

/** The prompt of the current question (waits for the round to be built). */
function shownText(container: HTMLElement): Promise<string> {
	return waitFor(() => {
		const el = container.querySelector('.shown');
		if (el === null) throw new Error('no question yet');
		return el.textContent!;
	});
}

describe('the writing-system trainer page', () => {
	it('shows the kana charts of a Japanese workspace with tabs, practice modes and one primary action', async () => {
		open('ja');
		render(ScriptsPage, { props: { rest: '' }, context: ctx.context });
		expect(await screen.findByRole('link', { name: 'Katakana' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'あ, a, Not seen yet' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'With dakuten' })).toBeTruthy();
		for (const mode of ['Recognise', 'Recall', 'Read', 'Type']) expect(screen.getByRole('link', { name: mode })).toBeTruthy();
		expect(primaryActions(document.body)).toHaveLength(1);
	});

	it('marks what the event log says is known', async () => {
		open('ja', known('hiragana:あ'));
		render(ScriptsPage, { props: { rest: '' }, context: ctx.context });
		expect(await screen.findByRole('button', { name: /^あ, a, Known/ })).toBeTruthy();
		expect(screen.getByText('1 / 104')).toBeTruthy();
	});

	it('shows the katakana chart by its route', async () => {
		open('ja');
		render(ScriptsPage, { props: { rest: 'katakana' }, context: ctx.context });
		expect(await screen.findByRole('button', { name: 'ア, a, Not seen yet' })).toBeTruthy();
	});

	it('opens the detail of a cell', async () => {
		open('ru');
		render(ScriptsPage, { props: { rest: '' }, context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: /^Р, r/ }));
		expect(screen.getByText('Keyboard key: H')).toBeTruthy();
		expect(screen.getByText('Looks like a Latin letter but sounds different.')).toBeTruthy();
	});

	it('Korean shows the Hangul chart and the syllable builder', async () => {
		open('ko');
		render(ScriptsPage, { props: { rest: '' }, context: ctx.context });
		expect(await screen.findByRole('heading', { name: 'Build a syllable' })).toBeTruthy();
		expect(screen.getByText('Reads as ga')).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Katakana' })).toBeNull();
	});

	it('offers nothing for a language without a writing system', async () => {
		open('es');
		render(ScriptsPage, { props: { rest: '' }, context: ctx.context });
		expect(await screen.findByText('This language has no writing system to practise here.')).toBeTruthy();
	});

	it('asks for a workspace when there is none', () => {
		ctx.session.workspaces.set({ list: [], current: null });
		render(ScriptsPage, { props: { rest: '' }, context: ctx.context });
		expect(screen.getByText('Choose a workspace to practise its writing system.')).toBeTruthy();
	});
});

describe('a practice round', () => {
	it('records a right answer as a script event, then a wrong one', async () => {
		const post = open('ja');
		const { container } = render(ScriptsPage, { props: { rest: 'hiragana/practice/recognise' }, context: ctx.context });
		const shown = () => shownText(container);
		const romanOf = (glyph: string) => systemById('hiragana')!.items.find((i) => i.glyph === glyph)!.roman;

		const first = await shown();
		await fireEvent.click(await screen.findByRole('button', { name: romanOf(first) }));
		expect(await screen.findByText('Correct.')).toBeTruthy();
		expect(post).toHaveBeenCalledTimes(1);
		const sent = post.mock.calls[0][0][0];
		expect(sent).toMatchObject({ workspaceId: 7, type: 'script', payload: { system: 'hiragana', item: `hiragana:${first}`, mode: 'recognise', ok: true } });

		await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
		const second = await waitFor(() => {
			const s = container.querySelector('.shown')!.textContent!;
			expect(s).not.toBe(first);
			return s;
		});
		const wrong = screen.getAllByRole('button').find((b) => b.classList.contains('option') && b.textContent !== romanOf(second))!;
		await fireEvent.click(wrong);
		expect(await screen.findByText(`Not quite. The answer is ${romanOf(second)}.`)).toBeTruthy();
		expect(post.mock.calls[1][0][0]).toMatchObject({ payload: { item: `hiragana:${second}`, ok: false } });
	});

	it('keeps an answer the server did not take, counts it, and sends it on the next visit', async () => {
		const post = open('ja');
		post.mockRejectedValue(new Error('offline'));
		const { container, unmount } = render(ScriptsPage, { props: { rest: 'hiragana/practice/recognise' }, context: ctx.context });
		const first = await shownText(container);
		const roman = systemById('hiragana')!.items.find((i) => i.glyph === first)!.roman;
		await fireEvent.click(await screen.findByRole('button', { name: roman }));
		await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
		const waiting = JSON.parse(localStorage.getItem('qinqin.scripts.pending.7') ?? '[]');
		expect(waiting).toHaveLength(1);
		expect(waiting[0]).toMatchObject({ type: 'script', payload: { item: `hiragana:${first}`, ok: true } });
		unmount();

		// Back online: the next visit sends it again with the same id, and the chart already counts it.
		post.mockReset().mockResolvedValue(undefined);
		// The server holds what was sent by the time the page reads the log again.
		vi.mocked(ctx.session.events.load).mockImplementation(async () => post.mock.calls.flat(2) as never);
		render(ScriptsPage, { props: { rest: '' }, context: ctx.context });
		expect(await screen.findByRole('button', { name: new RegExp(`^${first}, ${roman}, Learning`) })).toBeTruthy();
		await waitFor(() => expect(post).toHaveBeenCalledWith([expect.objectContaining({ id: waiting[0].id })]));
		await waitFor(() => expect(localStorage.getItem('qinqin.scripts.pending.7')).toBeNull());
	});

	it('finishes a round with a score and offers another', async () => {
		open('ru');
		const { container } = render(ScriptsPage, { props: { rest: 'cyrillic/practice/recall' }, context: ctx.context });
		for (let n = 0; n < 10; n++) {
			const options = await waitFor(() => {
				const list = [...container.querySelectorAll<HTMLButtonElement>('.option')];
				expect(list.length).toBe(4);
				return list;
			});
			await fireEvent.click(options[0]);
			await fireEvent.click(await screen.findByRole('button', { name: n === 9 ? 'Finish' : 'Next' }));
		}
		expect(await screen.findByText('Round finished')).toBeTruthy();
		expect(screen.getByText(/of 10 right/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Another round' })).toBeTruthy();
	});

	it('typing: the letter typed is checked against the chart', async () => {
		const post = open('ru');
		const { container } = render(ScriptsPage, { props: { rest: 'cyrillic/practice/type' }, context: ctx.context });
		const romanShown = await shownText(container);
		const item = systemById('cyrillic')!.items.find((i) => i.roman === romanShown)!;
		const input = await screen.findByLabelText('Your answer');
		await fireEvent.input(input, { target: { value: item.lower } });
		await fireEvent.click(screen.getByRole('button', { name: 'Check' }));
		expect(await screen.findByText('Correct.')).toBeTruthy();
		expect(post.mock.calls[0][0][0]).toMatchObject({ payload: { system: 'cyrillic', mode: 'type', ok: true } });
	});
});

describe('the kana trainer with romaji hidden (#284)', () => {
	function openHidden() {
		const ws = { id: 7, language: 'ja', name: '', settings: { romanisation: { romaji: 'never' } }, updatedAt: '' } as never;
		ctx.session.workspaces.set({ list: [ws], current: ws });
		vi.spyOn(ctx.session.events, 'load').mockResolvedValue([] as never);
		vi.spyOn(ctx.session.events, 'post').mockResolvedValue(undefined);
	}

	it('the chart has no romaji labels, a tap shows the romaji, and the romaji-answer modes are gone', async () => {
		openHidden();
		const { container } = render(ScriptsPage, { props: { rest: '' }, context: ctx.context });
		const cell = await screen.findByRole('button', { name: 'あ, Not seen yet' });
		expect(container.querySelector('.cell .roman')).toBeNull();
		expect(screen.queryByRole('link', { name: 'Recognise' })).toBeNull();
		expect(screen.queryByRole('link', { name: 'Read' })).toBeNull();
		expect(screen.getByRole('link', { name: 'Recall' })).toBeTruthy();
		expect(screen.getByTestId('romaji-hidden')).toBeTruthy();
		await fireEvent.click(cell);
		expect(container.querySelector('.detail .sound')?.textContent).toBe('a');
	});

	it('a Recall prompt is the sound, with the romaji behind a hint', async () => {
		openHidden();
		const { container } = render(ScriptsPage, { props: { rest: 'hiragana/practice/recall' }, context: ctx.context });
		const show = await screen.findByTestId('show-romaji');
		expect(container.querySelector('.shown')).toBeNull();
		await fireEvent.click(show);
		expect((await shownText(container)).length).toBeGreaterThan(0);
	});

	it('a Recognise round is not run', async () => {
		openHidden();
		const { container } = render(ScriptsPage, { props: { rest: 'hiragana/practice/recognise' }, context: ctx.context });
		expect(await screen.findByTestId('romaji-hidden')).toBeTruthy();
		expect(container.querySelector('.run')).not.toBeNull();
		expect(container.querySelector('.options')).toBeNull();
	});
});
