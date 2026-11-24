import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { deleteAiSentence, discardExample, generateExamples, getExamples, keepExample } from './examples';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

describe('AI examples api (#186)', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('reads the drafts and the default level leniently', async () => {
		vi.mocked(fetch).mockResolvedValue(
			json({ drafts: [{ id: 3, entryId: 9, hanzi: '我喜欢学习。', translation: 't' }, { id: 'x' }], defaultLevel: 'advanced' })
		);
		const v = await getExamples(9);
		expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/entries/9/examples');
		expect(v.defaultLevel).toBe('advanced');
		expect(v.drafts.map((d) => d.id)).toEqual([3]);
	});

	it('generates with a level and a request id', async () => {
		vi.mocked(fetch).mockResolvedValue(json({ drafts: [], dropped: 2, provider: 'openai', model: 'm' }));
		const g = await generateExamples(9, 'elementary', 'req-1');
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe('/api/entries/9/examples');
		expect(init?.method).toBe('POST');
		expect(JSON.parse(init?.body as string)).toEqual({ level: 'elementary', requestId: 'req-1' });
		expect(g).toEqual({ drafts: [], dropped: 2, provider: 'openai', model: 'm' });
	});

	it('keeps a draft and answers the sentence with its mark', async () => {
		vi.mocked(fetch).mockResolvedValue(
			json({ id: 70, entryId: 9, sourcePack: '', userId: 1, hanzi: 'h', pinyin: '', translation: 't', ai: { provider: 'gemini', model: 'g' } }, 201)
		);
		const s = await keepExample(9, 3);
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe('/api/entries/9/examples/3/keep');
		expect(init?.method).toBe('POST');
		expect(s.ai).toEqual({ provider: 'gemini', model: 'g' });
	});

	it('deletes a draft or a kept example, with an optional reason', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
		await discardExample(9, 3);
		await discardExample(9, 4, 'too_hard');
		await deleteAiSentence(9, 70, 'missing_word');
		await deleteAiSentence(9, 71);
		const calls = vi.mocked(fetch).mock.calls.map(([url, init]) => `${init?.method} ${url}`);
		expect(calls).toEqual([
			'DELETE /api/entries/9/examples/3',
			'DELETE /api/entries/9/examples/4?reason=too_hard',
			'DELETE /api/entries/9/sentences/70?reason=missing_word',
			'DELETE /api/entries/9/sentences/71'
		]);
	});
});
