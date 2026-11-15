import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const writer = {
	animateCharacter: vi.fn(() => Promise.resolve()),
	loopCharacterAnimation: vi.fn(() => Promise.resolve()),
	showCharacter: vi.fn(() => Promise.resolve()),
	pauseAnimation: vi.fn(() => Promise.resolve())
};
vi.mock('hanzi-writer', () => ({ default: { create: vi.fn(() => writer) } }));
vi.mock('$lib/study/strokeData', () => ({ fetchStrokeData: vi.fn() }));

import { fetchStrokeData } from '$lib/study/strokeData';
import StrokePlayer from './StrokePlayer.svelte';

const fetchMock = vi.mocked(fetchStrokeData);

beforeEach(() => {
	for (const fn of Object.values(writer)) fn.mockClear();
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('StrokePlayer', () => {
	it('shows a quiet loading placeholder while the data loads', async () => {
		fetchMock.mockReturnValue(new Promise(() => {}));
		render(StrokePlayer, { char: '好' });
		expect(await screen.findByText('Loading stroke order…')).toBeTruthy();
	});

	it('shows Play and Loop once ready and drops the placeholder', async () => {
		fetchMock.mockResolvedValue({ kind: 'ok', data: {} });
		render(StrokePlayer, { char: '好' });
		await screen.findByRole('button', { name: 'Play' });
		expect(screen.queryByText('Loading stroke order…')).toBeNull();
	});

	it('hides the player for a character without stroke data', async () => {
		fetchMock.mockResolvedValue({ kind: 'missing' });
		const { container } = render(StrokePlayer, { char: '好' });
		await waitFor(() => expect(container.querySelector('.stroke-player')).toBeNull());
	});

	it('offers Try again after a transient failure and recovers', async () => {
		fetchMock.mockResolvedValueOnce({ kind: 'error' }).mockResolvedValueOnce({ kind: 'ok', data: {} });
		render(StrokePlayer, { char: '好' });
		const retry = await screen.findByRole('button', { name: 'Try again' });
		expect(screen.getByText('Stroke order could not be loaded.')).toBeTruthy();
		await fireEvent.click(retry);
		await screen.findByRole('button', { name: 'Play' });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('handles a rejected animation promise (no unhandled rejection)', async () => {
		fetchMock.mockResolvedValue({ kind: 'ok', data: {} });
		const rejected = Promise.reject(new Error('animation failed'));
		const handled = vi.spyOn(rejected, 'catch');
		writer.animateCharacter.mockReturnValueOnce(rejected);
		render(StrokePlayer, { char: '好' });
		await fireEvent.click(await screen.findByRole('button', { name: 'Play' }));
		expect(handled).toHaveBeenCalled();
	});
});
