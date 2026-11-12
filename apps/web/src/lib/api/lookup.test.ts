import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { ApiError } from './client';
import { lookupAt } from './lookup';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function requestedURL(): URL {
	return new URL(String(vi.mocked(fetch).mock.calls[0][0]), 'http://localhost');
}

describe('lookupAt', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends a 16-code-point window at offset 0 to /api/lookup', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ results: [] }));
		await lookupAt('ja', 'ab' + 'あ'.repeat(30), 2);
		const url = requestedURL();
		expect(url.pathname).toBe('/api/lookup');
		expect(url.searchParams.get('lang')).toBe('ja');
		expect(url.searchParams.get('offset')).toBe('0');
		expect(url.searchParams.get('text')).toBe('あ'.repeat(16));
		expect(url.searchParams.has('kind')).toBe(false);
	});

	it('repeats kind per entry', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ results: [] }));
		await lookupAt('ja', '食べる', 0, ['word', 'character']);
		expect(requestedURL().searchParams.getAll('kind')).toEqual(['word', 'character']);
	});

	it('translates start/end back by the code-point offset (astral)', async () => {
		vi.mocked(fetch).mockResolvedValue(
			jsonResponse({ results: [{ entryId: 1, matched: '食べ', start: 0, end: 2 }] })
		);
		const results = await lookupAt('ja', '𠮷𠮷食べる', 2);
		expect(results[0].start).toBe(2);
		expect(results[0].end).toBe(4);
		expect(requestedURL().searchParams.get('text')).toBe('食べる');
	});

	it('normalises missing arrays to []', async () => {
		vi.mocked(fetch).mockResolvedValue(
			jsonResponse({ results: [{ entryId: 1, start: 0, end: 1 }] })
		);
		const [r] = await lookupAt('ja', '食', 0);
		for (const key of ['forms', 'readings', 'reasons', 'tags', 'frequencies', 'senses'] as const) {
			expect(r[key]).toEqual([]);
		}
	});

	it('normalises a missing results field to []', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({}));
		expect(await lookupAt('ja', '食', 0)).toEqual([]);
	});

	it('returns [] without a request when the offset is out of range', async () => {
		expect(await lookupAt('ja', 'abc', 3)).toEqual([]);
		expect(await lookupAt('ja', 'abc', -1)).toEqual([]);
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each([400, 413])('surfaces ApiError %i', async (status) => {
		vi.mocked(fetch).mockImplementation(async () => new Response('nope', { status }));
		await expect(lookupAt('ja', '食', 0)).rejects.toBeInstanceOf(ApiError);
		await expect(lookupAt('ja', '食', 0)).rejects.toMatchObject({ status });
	});

	it('forwards the abort signal', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ results: [] }));
		const controller = new AbortController();
		await lookupAt('ja', '食', 0, undefined, controller.signal);
		expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBe(controller.signal);
	});
});
