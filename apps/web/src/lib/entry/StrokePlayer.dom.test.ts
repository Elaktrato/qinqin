import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const writer = {
	animateCharacter: vi.fn(() => Promise.resolve()),
	animateStroke: vi.fn((_stroke: number) => Promise.resolve()),
	loopCharacterAnimation: vi.fn(() => Promise.resolve()),
	showCharacter: vi.fn(() => Promise.resolve()),
	pauseAnimation: vi.fn(() => Promise.resolve())
};
vi.mock('hanzi-writer', () => ({ default: { create: vi.fn(() => writer) } }));
vi.mock('$lib/writing/strokeData', () => ({ fetchStrokeData: vi.fn() }));

import HanziWriter from 'hanzi-writer';
import { fetchStrokeData } from '$lib/writing/strokeData';
import StrokePlayer from './StrokePlayer.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const fetchMock = vi.mocked(fetchStrokeData);
const data = { strokes: Array.from({ length: 13 }, () => ({})) };

function deferred<T = void>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

beforeEach(() => {
	// reset (not just clear): a test's queued returnValueOnce must not leak here.
	for (const fn of Object.values(writer)) fn.mockReset();
	writer.animateStroke.mockImplementation(() => Promise.resolve());
	vi.mocked(HanziWriter.create).mockReset();
	vi.mocked(HanziWriter.create).mockImplementation(() => writer as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('StrokePlayer', () => {
	it('shows a quiet loading placeholder while the data loads', async () => {
		fetchMock.mockReturnValue(new Promise(() => {}));
		render(StrokePlayer, { props: { char: '好' }, context: ctx.context });
		expect(await screen.findByText('Loading stroke order…')).toBeTruthy();
	});

	it('shows Play and Loop once ready and drops the placeholder', async () => {
		fetchMock.mockResolvedValue({ kind: 'ok', data });
		render(StrokePlayer, { props: { char: '好' }, context: ctx.context });
		expect(await screen.findByRole('button', { name: 'Play' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Loop' }).getAttribute('aria-pressed')).toBe('false');
		expect(screen.getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Play', 'Loop']);
		expect(screen.queryByText('Loading stroke order…')).toBeNull();
	});

	it('says the failed text for a character without stroke data (no empty box)', async () => {
		fetchMock.mockResolvedValue({ kind: 'missing' });
		render(StrokePlayer, { props: { char: '好' }, context: ctx.context });
		expect(await screen.findByText('Stroke order could not be loaded.')).toBeTruthy();
		expect(screen.queryByRole('img')).toBeNull();
	});

	it('offers Try again after a transient failure and recovers', async () => {
		fetchMock.mockResolvedValueOnce({ kind: 'error' }).mockResolvedValueOnce({ kind: 'ok', data });
		render(StrokePlayer, { props: { char: '好' }, context: ctx.context });
		const retry = await screen.findByRole('button', { name: 'Try again' });
		expect(screen.getByText('Stroke order could not be loaded.')).toBeTruthy();
		await fireEvent.click(retry);
		await screen.findByRole('button', { name: 'Play' });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('plays stroke by stroke with "勤 · 3 of 13" progress that is not announced', async () => {
		fetchMock.mockResolvedValue({ kind: 'ok', data });
		const strokes = [deferred(), deferred(), deferred()];
		for (let i = 0; i < 13; i++) {
			writer.animateStroke.mockReturnValueOnce((strokes[i] ?? deferred()).promise as never);
		}
		const { container } = render(StrokePlayer, { props: { char: '勤' }, context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
		strokes[0].resolve();
		await waitFor(() => expect(container.textContent).toContain('勤 · 1 of 13'));
		strokes[1].resolve();
		await waitFor(() => expect(container.textContent).toContain('勤 · 2 of 13'));
		strokes[2].resolve();
		await waitFor(() => expect(container.textContent).toContain('勤 · 3 of 13'));
		const progress = container.querySelector('[data-progress]');
		expect(progress?.getAttribute('aria-live')).toBe('off');
		expect(writer.animateStroke.mock.calls.map((c) => c[0])).toEqual([0, 1, 2, 3]);
	});

	it('Pause stops at the current stroke and becomes Play again', async () => {
		fetchMock.mockResolvedValue({ kind: 'ok', data });
		const pending = deferred();
		writer.animateStroke.mockImplementation(() => pending.promise as never);
		const { container } = render(StrokePlayer, { props: { char: '勤' }, context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
		await waitFor(() => expect(container.textContent).toContain('勤 · 1 of 13'));
		await fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
		expect(await screen.findByRole('button', { name: 'Play' })).toBeTruthy();
		expect(writer.pauseAnimation).toHaveBeenCalled();
		pending.resolve();
		await waitFor(() => expect(container.textContent).toContain('勤 · 1 of 13'));
		expect(writer.animateStroke).toHaveBeenCalledTimes(1);
	});

	it('Loop is a toggle with aria-pressed', async () => {
		fetchMock.mockResolvedValue({ kind: 'ok', data });
		render(StrokePlayer, { props: { char: '好' }, context: ctx.context });
		const loop = await screen.findByRole('button', { name: 'Loop' });
		await fireEvent.click(loop);
		expect(loop.getAttribute('aria-pressed')).toBe('true');
		expect(writer.loopCharacterAnimation).toHaveBeenCalled();
		await fireEvent.click(loop);
		expect(loop.getAttribute('aria-pressed')).toBe('false');
	});

	it('reads the stroke and outline colours from --accent and --line', async () => {
		fetchMock.mockResolvedValue({ kind: 'ok', data });
		const { container } = render(StrokePlayer, { props: { char: '好' }, context: ctx.context });
		const canvas = container.querySelector('.canvas') as HTMLElement;
		canvas.style.setProperty('--accent', 'rgb(1, 2, 3)');
		canvas.style.setProperty('--line', 'rgb(4, 5, 6)');
		await waitFor(() => expect(HanziWriter.create).toHaveBeenCalled());
		const options = vi.mocked(HanziWriter.create).mock.calls[0][2] as unknown as Record<string, unknown>;
		expect(options.strokeColor).toBe('rgb(1, 2, 3)');
		expect(options.outlineColor).toBe('rgb(4, 5, 6)');
	});

	it('handles a rejected animation promise (no unhandled rejection)', async () => {
		fetchMock.mockResolvedValue({ kind: 'ok', data });
		const rejected = Promise.reject(new Error('animation failed'));
		const handled = vi.spyOn(rejected, 'catch');
		writer.animateStroke.mockReturnValueOnce(rejected);
		render(StrokePlayer, { props: { char: '好' }, context: ctx.context });
		await fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
		// The play loop starts asynchronously; let its first stroke begin.
		await new Promise((r) => setTimeout(r, 0));
		await waitFor(() => expect(handled).toHaveBeenCalled());
	});
});
