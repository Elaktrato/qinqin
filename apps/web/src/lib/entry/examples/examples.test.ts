import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';
import type { ExampleDraft, Generated } from '$lib/api/examples';
import { aiLabel, generateErrorText, generatedText, reasonLabel, runGenerate } from './examples';

const draft = (id: number, requestId: string): ExampleDraft => ({
	id,
	entryId: 1,
	hanzi: `h${id}`,
	pinyin: '',
	translation: 't',
	level: 'beginner',
	provider: 'anthropic',
	model: 'm',
	requestId
});

const apiError = (status: number, code: string, retry?: number) =>
	new ApiError(status, JSON.stringify({ error: code, message: 'x' }), retry);

describe('aiLabel', () => {
	it('names the model and the provider by its display name', () => {
		const names = new Map([['anthropic', 'Anthropic']]);
		expect(aiLabel({ provider: 'anthropic', model: 'claude-opus-5-5' }, names)).toBe('AI-written · claude-opus-5-5 · Anthropic');
		expect(aiLabel({ provider: 'custom-x', model: '' }, names)).toBe('AI-written · custom-x');
		expect(aiLabel({ provider: '', model: '' }, names)).toBe('AI-written');
	});
});

describe('reasonLabel', () => {
	it('words every reason', () => {
		expect(reasonLabel('missing_word')).toBe('The word is missing');
		expect(reasonLabel('other')).toBe('Something else');
	});
});

describe('generatedText', () => {
	it('says how many arrived and how many were left out', () => {
		expect(generatedText({ drafts: [draft(1, 'r'), draft(2, 'r')], dropped: 0, provider: '', model: '' })).toBe('2 new examples. Keep the ones you like.');
		expect(generatedText({ drafts: [draft(1, 'r')], dropped: 2, provider: '', model: '' })).toBe(
			'1 new example. Keep it if you like it. 2 were left out because they did not contain the word or did not fit.'
		);
		expect(generatedText({ drafts: [], dropped: 5, provider: '', model: '' })).toBe(
			'None of the sentences contained the word in a form the app recognises. Try again or another level.'
		);
	});
});

describe('generateErrorText', () => {
	it('words the examples codes and falls back to the AI texts', () => {
		expect(generateErrorText(apiError(409, 'examples_full'))).toBe('This word has as many AI examples as it can keep. Delete one first.');
		expect(generateErrorText(apiError(409, 'no_key'))).toBe('Add an API key in Settings → AI first.');
	});
});

describe('runGenerate', () => {
	const ok: Generated = { drafts: [draft(1, 'req')], dropped: 0, provider: 'anthropic', model: 'm' };

	it('answers the generation', async () => {
		const io = { send: vi.fn().mockResolvedValue(ok), reload: vi.fn() };
		expect(await runGenerate(io, 'beginner', 'req')).toEqual({ generated: ok, error: null });
		expect(io.send).toHaveBeenCalledWith('beginner', 'req');
		expect(io.reload).not.toHaveBeenCalled();
	});

	it('after a lost answer polls until drafts of THIS request appear', async () => {
		const lost = new TypeError('network');
		const onWaiting = vi.fn();
		const reload = vi
			.fn()
			.mockResolvedValueOnce({ drafts: [draft(9, 'other')], defaultLevel: 'beginner' })
			.mockResolvedValueOnce({ drafts: [draft(4, 'req'), draft(5, 'req')], defaultLevel: 'beginner' });
		const io = { send: vi.fn().mockRejectedValue(lost), reload };
		const r = await runGenerate(io, 'beginner', 'req', { sleep: async () => {}, onWaiting });
		expect(onWaiting).toHaveBeenCalledTimes(1);
		expect(r.error).toBeNull();
		expect(r.generated?.drafts.map((d) => d.id)).toEqual([4, 5]);
		expect(reload).toHaveBeenCalledTimes(2);
	});

	it('polls after in_flight too, and gives up with the error', async () => {
		const busy = apiError(409, 'in_flight');
		const io = { send: vi.fn().mockRejectedValue(busy), reload: vi.fn().mockResolvedValue({ drafts: [], defaultLevel: 'beginner' }) };
		const r = await runGenerate(io, 'beginner', 'req', { sleep: async () => {}, intervalMs: 1, timeoutMs: 2 });
		expect(r).toEqual({ generated: null, error: busy });
		expect(io.reload).toHaveBeenCalled();
	});

	it('does not poll after a refusal', async () => {
		const full = apiError(409, 'examples_full');
		const io = { send: vi.fn().mockRejectedValue(full), reload: vi.fn() };
		expect(await runGenerate(io, 'beginner', 'req')).toEqual({ generated: null, error: full });
		expect(io.reload).not.toHaveBeenCalled();
	});
});
