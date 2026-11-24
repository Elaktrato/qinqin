import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(async () => {}) }));
vi.mock('$lib/api/examples', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/examples')>()),
	getExamples: vi.fn(),
	generateExamples: vi.fn(),
	keepExample: vi.fn(),
	discardExample: vi.fn()
}));
vi.mock('$lib/api/ai', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/ai')>()),
	getAiStatus: vi.fn(),
	getAiProviders: vi.fn(async () => ({ providers: [{ id: 'anthropic', name: 'Anthropic' }], canManageCustom: false, privateAllowed: false }))
}));

import { getAiStatus } from '$lib/api/ai';
import { discardExample, generateExamples, getExamples, keepExample, type ExampleDraft } from '$lib/api/examples';
import type { Sentence } from '$lib/api/types';
import AiExamples from './AiExamples.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
	vi.mocked(getAiStatus).mockResolvedValue({ available: true } as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const draft = (id: number, hanzi: string): ExampleDraft => ({
	id,
	entryId: 7,
	hanzi,
	pinyin: 'pīnyīn',
	translation: `t${id}`,
	level: 'elementary',
	provider: 'anthropic',
	model: 'claude-opus-5-5',
	requestId: 'r'
});

const sentence = (id: number, hanzi: string, ai: Sentence['ai'] = null): Sentence => ({
	id,
	entryId: 7,
	sourcePack: '',
	userId: 1,
	hanzi,
	pinyin: '',
	translation: 't',
	ai
});

function mount(sentences: Sentence[], onkept = vi.fn()) {
	render(AiExamples, { props: { entry: { id: 7, language: 'zh', sentences }, onkept }, context: ctx.context });
	return onkept;
}

describe('AiExamples', () => {
	it('generates at the default level, shows the drafts marked with model and provider, and keeps one', async () => {
		vi.mocked(getExamples).mockResolvedValue({ drafts: [], defaultLevel: 'elementary' });
		vi.mocked(generateExamples).mockResolvedValue({ drafts: [draft(1, '我喜欢学习。'), draft(2, '学习很好。')], dropped: 1, provider: 'anthropic', model: 'claude-opus-5-5' });
		const kept = sentence(50, '我喜欢学习。', { provider: 'anthropic', model: 'claude-opus-5-5' });
		vi.mocked(keepExample).mockResolvedValue(kept);
		const onkept = mount([sentence(9, '你好。')]);
		const level = (await screen.findByRole('combobox', { name: 'Your level' })) as HTMLSelectElement;
		await waitFor(() => expect(level.value).toBe('elementary'));
		expect(screen.getByText(/Sent to your provider: the word/)).toBeTruthy();
		const button = screen.getByRole('button', { name: 'Generate examples' });
		await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'));
		await fireEvent.click(button);
		expect(generateExamples).toHaveBeenCalledWith(7, 'elementary', expect.stringMatching(/^[0-9A-Z]{26}$/));
		expect((await screen.findByRole('status')).textContent).toContain('2 new examples. Keep the ones you like. 1 was left out');
		expect(screen.getAllByText('AI-written · claude-opus-5-5 · Anthropic')).toHaveLength(2);
		// The buttons name the sentence they act on.
		const keep = screen.getAllByRole('button', { name: 'Keep' })[0];
		expect(document.getElementById(keep.getAttribute('aria-describedby') ?? '')?.textContent).toBe('我喜欢学习。');
		await fireEvent.click(keep);
		await waitFor(() => expect(onkept).toHaveBeenCalledWith(kept));
		expect(keepExample).toHaveBeenCalledWith(7, 1);
		expect(screen.queryByText('我喜欢学习。')).toBeNull();
		expect(screen.getByRole('status').textContent).toContain('Kept.');
		// Generating again replaces what was not kept, and says so.
		expect(screen.getByRole('button', { name: 'Generate new examples' })).toBeTruthy();
		expect(screen.getByText(/New examples replace the ones you have not kept/)).toBeTruthy();
	});

	it('reports a draft with a reason from a picker, and deletes one without', async () => {
		vi.mocked(getExamples).mockResolvedValue({ drafts: [draft(1, '我喜欢学习。'), draft(2, '学习很好。')], defaultLevel: 'beginner' });
		vi.mocked(discardExample).mockResolvedValue();
		mount([]);
		await screen.findByText('我喜欢学习。');
		await fireEvent.click(screen.getAllByRole('button', { name: 'Report' })[0]);
		const reason = screen.getByRole('combobox', { name: 'What is wrong with it?' }) as HTMLSelectElement;
		await waitFor(() => expect(document.activeElement).toBe(reason));
		await fireEvent.change(reason, { target: { value: 'wrong_translation' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Report and delete' }));
		await waitFor(() => expect(discardExample).toHaveBeenCalledWith(7, 1, 'wrong_translation'));
		await waitFor(() => expect(screen.queryByText('我喜欢学习。')).toBeNull());
		expect(screen.getByRole('status').textContent).toContain('Reported and deleted.');
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await waitFor(() => expect(discardExample).toHaveBeenCalledWith(7, 2, undefined));
	});

	it('keeps the focus on the button while a generation runs, and polls after a lost answer', async () => {
		vi.mocked(getExamples)
			.mockResolvedValueOnce({ drafts: [], defaultLevel: 'beginner' })
			.mockResolvedValue({ drafts: [{ ...draft(3, '学习。'), requestId: 'x' }], defaultLevel: 'beginner' });
		let reject!: (e: unknown) => void;
		vi.mocked(generateExamples).mockImplementation(() => new Promise((_, r) => (reject = r)));
		mount([]);
		const button = await screen.findByRole('button', { name: 'Generate examples' });
		await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'));
		button.focus();
		await fireEvent.click(button);
		expect(button.getAttribute('aria-disabled')).toBe('true');
		expect(document.activeElement).toBe(button);
		await fireEvent.click(button);
		expect(generateExamples).toHaveBeenCalledTimes(1);
		const requestId = vi.mocked(generateExamples).mock.calls[0][2];
		vi.mocked(getExamples).mockResolvedValue({ drafts: [{ ...draft(3, '学习。'), requestId }], defaultLevel: 'beginner' });
		reject(new TypeError('network'));
		expect(await screen.findByText('学习。', {}, { timeout: 8000 })).toBeTruthy();
	}, 15000);

	it('points to Settings → AI without a key', async () => {
		vi.mocked(getExamples).mockResolvedValue({ drafts: [], defaultLevel: 'beginner' });
		vi.mocked(getAiStatus).mockResolvedValue({ available: false } as never);
		mount([]);
		const link = await screen.findByRole('link', { name: 'Open Settings → AI' });
		expect(link.getAttribute('href')).toBe('/settings?tab=ai');
		expect(screen.queryByRole('button', { name: 'Generate examples' })).toBeNull();
	});

	it('stays hidden for a word with enough examples and no drafts', async () => {
		vi.mocked(getExamples).mockResolvedValue({ drafts: [], defaultLevel: 'beginner' });
		mount([sentence(1, '一。'), sentence(2, '二。'), sentence(3, '三。')]);
		await waitFor(() => expect(getExamples).toHaveBeenCalled());
		await Promise.resolve();
		expect(screen.queryByRole('heading', { name: 'AI examples' })).toBeNull();
	});

	it('words a refused generation by its code', async () => {
		vi.mocked(getExamples).mockResolvedValue({ drafts: [], defaultLevel: 'beginner' });
		const { ApiError } = await import('$lib/api/client');
		vi.mocked(generateExamples).mockRejectedValue(new ApiError(409, JSON.stringify({ error: 'examples_full', message: 'x' })));
		mount([]);
		const button = await screen.findByRole('button', { name: 'Generate examples' });
		await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('false'));
		await fireEvent.click(button);
		expect((await screen.findByRole('alert')).textContent).toContain('as many AI examples as it can keep');
	});
});
