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
	{ seq: 1, role: 'partner', text: '你好！', annotations: [], model: 'm1', provider: 'anthropic', turnId: 'p', createdAt: '' },
	{ seq: 2, role: 'learner', text: '我是很好。', annotations: [ann('m2a1', '是很', '我', '好。')], model: '', provider: '', turnId: 'p', createdAt: '' },
	{ seq: 3, role: 'partner', text: '好。', annotations: [], model: 'm2', provider: 'openai', turnId: 'p', createdAt: '' },
	{ seq: 4, role: 'learner', text: '我去公园了。我去公园。', annotations: [ann('m4a1', '公园', '我去', '了。我去公园。', 'suggestion'), ann('m4a2', '园了', '我去公', '。我去公园。')], model: '', provider: '', turnId: 'p', createdAt: '' }
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
	it('names the limit in the too-long hint', () => {
		expect(turnGate({ ...ready, text: '字'.repeat(1001) }).hint).toBe('A message has at most 1,000 characters.');
	});

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
import { runTurn, saveAsEntry, startBody, turnErrorText } from './talk';
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
	const noSleep = async () => {};
	const withTurn = (n: number, turnId: string): Conversation => {
		const c = conv(n);
		return { ...c, messages: c.messages.map((m, i) => (i >= n - 2 ? { ...m, turnId } : m)) };
	};

	it('answers the stored conversation and sends the turn id', async () => {
		const send = vi.fn(async () => conv(3));
		expect(await runTurn({ send, reload: vi.fn() }, '我', 't1')).toEqual({ conversation: conv(3), error: null, gone: false });
		expect(send).toHaveBeenCalledWith('我', 't1');
	});

	it('reads a 404 as a conversation that is gone', async () => {
		const r = await runTurn({ send: async () => Promise.reject(apiError(404, 'not_found')), reload: vi.fn() }, 'x', 't1');
		expect(r.gone).toBe(true);
	});

	it('waits for a slow answer the network lost: not yet grown, then this turn arrives', async () => {
		const reloads = [conv(1), conv(1), withTurn(3, 't1')];
		const reload = vi.fn(async () => reloads.shift() ?? null);
		const waiting = vi.fn();
		const r = await runTurn({ send: async () => Promise.reject(new TypeError('network')), reload }, 'x', 't1', { sleep: noSleep, onWaiting: waiting });
		expect(r.conversation?.messages).toHaveLength(3);
		expect(reload).toHaveBeenCalledTimes(3);
		expect(waiting).toHaveBeenCalledOnce();
	});

	it('sends the same turn again when another call held the slot (in_flight: this one never ran)', async () => {
		const reload = vi.fn();
		const send = vi.fn().mockRejectedValueOnce(apiError(409, 'in_flight')).mockResolvedValueOnce(withTurn(3, 't1'));
		const r = await runTurn({ send, reload }, 'x', 't1', { sleep: noSleep });
		expect(r.conversation?.messages).toHaveLength(3);
		expect(send).toHaveBeenNthCalledWith(2, 'x', 't1');
		expect(reload).not.toHaveBeenCalled();
	});

	it('gives up on in_flight after the backoff without polling', async () => {
		const reload = vi.fn();
		const busy = apiError(409, 'in_flight');
		const r = await runTurn({ send: async () => Promise.reject(busy), reload }, 'x', 't1', { sleep: noSleep });
		expect(r).toEqual({ conversation: null, error: busy, gone: false });
		expect(reload).not.toHaveBeenCalled();
	});

	it('does not take growth from another tab for this turn', async () => {
		const lost = new TypeError('network');
		const reload = vi.fn(async () => withTurn(3, 'other'));
		const r = await runTurn({ send: async () => Promise.reject(lost), reload }, 'x', 't1', { sleep: noSleep, timeoutMs: 20, intervalMs: 10 });
		expect(r).toEqual({ conversation: null, error: lost, gone: false });
	});

	it('keeps a definite provider error without polling', async () => {
		const refused = apiError(422, 'refused');
		const reload = vi.fn();
		expect((await runTurn({ send: async () => Promise.reject(refused), reload }, 'x', 't1')).error).toBe(refused);
		expect(reload).not.toHaveBeenCalled();
	});
});

describe('turnErrorText', () => {
	it('words the turn refusals for a message, else as the journal does', () => {
		expect(turnErrorText(apiError(413, 'too_long'))).toBe('A message has at most 1,000 characters.');
		expect(turnErrorText(apiError(422, 'empty'))).toBe('Write a message first.');
		expect(turnErrorText(apiError(409, 'conversation_limit'))).toBe('You have 20 open conversations. Save or discard one first.');
		expect(turnErrorText(apiError(422, 'wrong_language'))).toContain("this workspace's language");
	});
});

describe('startBody', () => {
	it('sends a plain topic of at most 200 code points and a known level', () => {
		expect(startBody(' 周末 ', 'advanced')).toEqual({ topic: '周末', level: 'advanced' });
		expect(startBody('a\u000bb', 'odd' as never)).toEqual({ topic: 'ab', level: 'beginner' });
		expect([...startBody('字'.repeat(201), 'beginner').topic]).toHaveLength(200);
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
