import { describe, expect, it, vi } from 'vitest';
import { conversationCorrections, defaultLevel, lastAnswer, turnGate } from './talk';
import type { Message } from './types';

const ann = (id: string, quote: string, prefix: string, suffix: string, kind: 'mistake' | 'suggestion' = 'mistake') => ({
	id,
	quote,
	prefix,
	suffix,
	correction: quote + '!',
	explanation: 'e',
	category: 'grammar',
	kind
});

const messages: Message[] = [
	{ seq: 1, role: 'partner', text: '你好！', annotations: [], model: 'm1', provider: 'anthropic', createdAt: '' },
	{ seq: 2, role: 'learner', text: '我是很好。', annotations: [ann('m2a1', '是很', '我', '好。')], model: '', provider: '', createdAt: '' },
	{ seq: 3, role: 'partner', text: '好。', annotations: [], model: 'm2', provider: 'openai', createdAt: '' },
	{ seq: 4, role: 'learner', text: '我去公园了。我去公园。', annotations: [ann('m4a1', '公园', '我去', '了。我去公园。', 'suggestion'), ann('m4a2', '园了', '我去公', '。我去公园。')], model: '', provider: '', createdAt: '' }
];

describe('conversationCorrections', () => {
	it('joins the corrections of every learner message into one list in conversation order', () => {
		const { list, placed } = conversationCorrections(messages);
		expect(list.map((c) => [c.annotation.id, c.kind, c.state, c.index])).toEqual([
			['m2a1', 'mistake', 'placed', 0],
			['m4a1', 'suggestion', 'placed', 1],
			['m4a2', 'mistake', 'listOnly', 2]
		]);
		expect(placed.get(2)?.map((p) => [p.start, p.end])).toEqual([[1, 3]]);
		expect(placed.get(4)?.map((p) => p.annotation.id)).toEqual(['m4a1']);
		expect(placed.has(1)).toBe(false);
	});

	it('is empty without learner corrections', () => {
		expect(conversationCorrections([messages[0]]).list).toEqual([]);
	});
});

describe('defaultLevel', () => {
	it('is the level of the most recently updated conversation, else beginner', () => {
		expect(defaultLevel([])).toBe('beginner');
		expect(
			defaultLevel([
				{ id: 'a', topic: '', level: 'advanced', messageCount: 0, createdAt: '', updatedAt: '2026-11-01' },
				{ id: 'b', topic: '', level: 'intermediate', messageCount: 0, createdAt: '', updatedAt: '2026-11-24' }
			])
		).toBe('intermediate');
	});
});

describe('lastAnswer', () => {
	it('names the model and provider of the latest partner message', () => {
		expect(lastAnswer(messages)).toEqual({ model: 'm2', provider: 'openai' });
		expect(lastAnswer([messages[1]])).toBeNull();
	});
});

describe('turnGate', () => {
	const ready = { available: true, banner: null, opened: true, full: false, busy: false };
	it('sends a non-empty message while the AI is usable and the conversation has room', () => {
		expect(turnGate({ ...ready, text: '你好' }).enabled).toBe(true);
		expect(turnGate({ ...ready, text: '  ' }).enabled).toBe(false);
		expect(turnGate({ ...ready, text: 'x', busy: true }).enabled).toBe(false);
		expect(turnGate({ ...ready, text: '字'.repeat(1001) })).toMatchObject({ enabled: false, hint: expect.any(String) });
		expect(turnGate({ ...ready, text: 'x', full: true })).toMatchObject({ enabled: false, hint: expect.any(String) });
	});

	it('says why the AI cannot answer and links the settings', () => {
		expect(turnGate({ ...ready, text: 'x', available: false, banner: 'No key.' })).toEqual({ enabled: false, hint: 'No key.', settingsLink: true });
		expect(turnGate({ ...ready, text: 'x', available: null }).enabled).toBe(false);
	});

	it('lets the partner open an empty conversation without text', () => {
		expect(turnGate({ ...ready, opened: false, text: '' }).enabled).toBe(true);
	});
});

import { ApiError } from '$lib/api/client';
import { runTurn, saveAsEntry } from './talk';
import type { Conversation } from './types';

const conv = (n: number): Conversation => ({
	id: 'c1',
	topic: '',
	level: 'beginner',
	createdAt: '',
	updatedAt: '',
	messages: messages.slice(0, n)
});
const apiError = (status: number, code: string) =>
	new ApiError(status, JSON.stringify({ error: code, message: 'x' }));

describe('runTurn', () => {
	it('answers the stored conversation', async () => {
		const send = vi.fn(async () => conv(3));
		expect(await runTurn({ send, reload: vi.fn() }, conv(1), '我')).toEqual({ conversation: conv(3), error: null, gone: false });
		expect(send).toHaveBeenCalledWith('我');
	});

	it('reads a 404 as a conversation that is gone', async () => {
		const r = await runTurn({ send: async () => Promise.reject(apiError(404, 'not_found')), reload: vi.fn() }, conv(1), 'x');
		expect(r.gone).toBe(true);
	});

	it('finds the answer of a turn whose reply was lost on the way (a proxy cut it)', async () => {
		const reload = vi.fn(async () => conv(3));
		const r = await runTurn({ send: async () => Promise.reject(new TypeError('network')), reload }, conv(1), 'x');
		expect(r).toEqual({ conversation: conv(3), error: null, gone: false });
	});

	it('keeps the error when the reload shows nothing new, and for a provider error', async () => {
		const lost = new TypeError('network');
		expect((await runTurn({ send: async () => Promise.reject(lost), reload: async () => conv(1) }, conv(1), 'x')).error).toBe(lost);
		const refused = apiError(422, 'refused');
		const reload = vi.fn();
		expect((await runTurn({ send: async () => Promise.reject(refused), reload }, conv(1), 'x')).error).toBe(refused);
		expect(reload).not.toHaveBeenCalled();
	});
});

describe('saveAsEntry', () => {
	it('saves, puts the entry in the column and records the journal day', async () => {
		const entry = { id: 'E1', date: '2026-11-24', title: '', text: 'x', source: 'typed' as const, createdAt: '', updatedAt: '' };
		const upsert = vi.fn();
		const record = vi.fn(async () => {});
		expect(await saveAsEntry({ save: async () => entry, upsert, record })).toBe(entry);
		expect(upsert).toHaveBeenCalledWith(entry);
		expect(record).toHaveBeenCalledWith('E1');
	});

	it('does not fail the save when the study event cannot be recorded', async () => {
		const entry = { id: 'E1', date: '', title: '', text: '', source: 'typed' as const, createdAt: '', updatedAt: '' };
		await expect(saveAsEntry({ save: async () => entry, upsert: vi.fn(), record: async () => Promise.reject(new Error('x')) })).resolves.toBe(entry);
	});
});
