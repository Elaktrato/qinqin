import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	discardConversation,
	getConversation,
	listConversations,
	saveConversation,
	sendTurn,
	startConversation
} from './conversations';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

const conv = { id: 'c1', topic: 't', level: 'elementary', createdAt: 'a', updatedAt: 'b', messages: [] };

describe('conversation routes', () => {
	beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
	afterEach(() => vi.unstubAllGlobals());

	it('lists summaries newest first and drops malformed rows', async () => {
		vi.mocked(fetch).mockResolvedValue(
			json([
				{ id: 'old', topic: '', level: 'beginner', messageCount: 2, createdAt: 'a', updatedAt: '2026-11-01T00:00:00Z' },
				{ topic: 'no id' },
				{ id: 'new', topic: 'x', level: 'odd', messageCount: 'many', createdAt: 'a', updatedAt: '2026-11-24T00:00:00Z' }
			])
		);
		const list = await listConversations(3);
		expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/journal/conversations?workspace=3');
		expect(list.map((s) => [s.id, s.level, s.messageCount])).toEqual([
			['new', 'beginner', 0],
			['old', 'beginner', 2]
		]);
	});

	it('starts, reads, sends a turn, saves and discards', async () => {
		vi.mocked(fetch).mockImplementation(async (url, init) =>
			init?.method === 'DELETE' ? new Response(null, { status: 204 }) : String(url).includes('/save') ? json({ id: 'E1', text: 'x' }) : json(conv)
		);
		await startConversation(3, '周末', 'elementary');
		let [url, init] = vi.mocked(fetch).mock.calls[0];
		expect([url, init?.method, JSON.parse(init?.body as string)]).toEqual([
			'/api/journal/conversations?workspace=3',
			'POST',
			{ topic: '周末', level: 'elementary' }
		]);
		expect((await getConversation(3, 'c1'))?.id).toBe('c1');
		expect(vi.mocked(fetch).mock.calls[1][0]).toBe('/api/journal/conversations/c1?workspace=3');
		const signal = new AbortController().signal;
		await sendTurn(3, 'c1', '你好', 'T1', signal);
		[url, init] = vi.mocked(fetch).mock.calls[2];
		expect([url, JSON.parse(init?.body as string), init?.signal]).toEqual(['/api/journal/conversations/c1/turn?workspace=3', { text: '你好', turnId: 'T1' }, signal]);
		const entry = await saveConversation(3, 'c1', 'E1', '2026-11-24');
		expect(entry?.id).toBe('E1');
		[url, init] = vi.mocked(fetch).mock.calls[3];
		expect([url, JSON.parse(init?.body as string)]).toEqual(['/api/journal/conversations/c1/save?workspace=3', { entryId: 'E1', date: '2026-11-24' }]);
		await discardConversation(3, 'c1');
		expect(vi.mocked(fetch).mock.calls[4][1]?.method).toBe('DELETE');
	});

	it('reads a missing conversation as null and a discarded one as done', async () => {
		vi.mocked(fetch).mockImplementation(async () => json({ error: 'not_found', message: 'x' }, 404));
		expect(await getConversation(3, 'gone')).toBeNull();
		await expect(discardConversation(3, 'gone')).resolves.toBeUndefined();
	});

	it('refuses an answer that is not a conversation', async () => {
		vi.mocked(fetch).mockResolvedValue(json({ nope: true }));
		await expect(sendTurn(3, 'c1', 'x', 'T1')).rejects.toThrow();
	});
});
