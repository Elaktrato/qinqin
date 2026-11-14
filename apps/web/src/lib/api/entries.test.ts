import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { addSentence } from './entries';

describe('addSentence', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => (k === 'qinqin.token' ? 'tok' : null)
		});
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('POSTs only the sentence text to the entry', async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({ id: 5, hanzi: '我学习中文。' }), {
				status: 201,
				headers: { 'content-type': 'application/json' }
			})
		);

		expect((await addSentence(42, '我学习中文。')).id).toBe(5);

		const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/entries/42/sentences');
		expect(init.method).toBe('POST');
		expect(JSON.parse(String(init.body))).toEqual({ hanzi: '我学习中文。' });
		expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
	});
});
