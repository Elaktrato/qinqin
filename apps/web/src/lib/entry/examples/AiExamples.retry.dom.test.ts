// The panel's request ids and its poll's lifetime (#186 fix wave), with the
// generate flow (runGenerate) faked so a lost answer ends at once.
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('$lib/api/examples', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/examples')>()),
	getExamples: vi.fn(async () => ({ drafts: [], defaultLevel: 'beginner', lastRequest: null }))
}));
vi.mock('$lib/api/ai', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/ai')>()),
	getAiStatus: vi.fn(async () => ({ available: true })),
	getAiProviders: vi.fn(async () => ({ providers: [], canManageCustom: false, privateAllowed: false }))
}));
vi.mock('./examples', async (importOriginal) => ({
	...(await importOriginal<typeof import('./examples')>()),
	runGenerate: vi.fn()
}));

import { runGenerate } from './examples';
import AiExamples from './AiExamples.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const mount = () => render(AiExamples, { props: { entry: { id: 7, language: 'zh', sentences: [] }, onkept: vi.fn() }, context: ctx.context });

async function ready(): Promise<HTMLElement> {
	const button = await screen.findByRole('button', { name: 'Generate examples' });
	await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'));
	return button;
}

describe('AiExamples request ids and the poll', () => {
	it('reuses the request id after a lost answer at the same level, a new one when the level changed', async () => {
		vi.mocked(runGenerate).mockResolvedValue({ generated: null, error: new TypeError('network') });
		mount();
		const button = await ready();
		const last = () => vi.mocked(runGenerate).mock.calls.at(-1)!;
		await fireEvent.click(button);
		await waitFor(() => expect(runGenerate).toHaveBeenCalledTimes(1));
		const first = last()[2];
		await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'));
		await fireEvent.click(button);
		await waitFor(() => expect(runGenerate).toHaveBeenCalledTimes(2));
		expect(last()[2]).toBe(first);
		await fireEvent.change(screen.getByRole('combobox', { name: 'Your level' }), { target: { value: 'advanced' } });
		await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'));
		await fireEvent.click(button);
		await waitFor(() => expect(runGenerate).toHaveBeenCalledTimes(3));
		expect(last()[1]).toBe('advanced');
		expect(last()[2]).not.toBe(first);
	});

	it('aborts the poll when the panel goes away', async () => {
		let signal: AbortSignal | undefined;
		vi.mocked(runGenerate).mockImplementation((_io, _level, _id, opts) => {
			signal = opts?.signal;
			return new Promise(() => {});
		});
		const view = mount();
		await fireEvent.click(await ready());
		await waitFor(() => expect(signal).toBeDefined());
		expect(signal?.aborted).toBe(false);
		view.unmount();
		expect(signal?.aborted).toBe(true);
	});
});
