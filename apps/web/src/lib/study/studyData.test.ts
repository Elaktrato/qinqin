import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { workspaces } from '../workspaces';
import { addCard, createDeck } from './store';
import {
	STUDY_DATA_TTL_MS,
	createStudyDataCache,
	getStudyData,
	hasCard,
	invalidateStudyData
} from './studyData';
import { pagedPull } from './testing/legacyCodec';
import type { StudyCard, StudyData } from './types';

function data(entryIds: number[] = []): StudyData {
	return {
		decks: [],
		cards: entryIds.map((entryId, i) => ({
			id: `c${i}`,
			kind: 'vocab',
			entryId,
			deckIds: ['general'],
			createdAt: '2026-01-01T00:00:00Z'
		}))
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('createStudyDataCache', () => {
	let clock = 0;
	const now = () => clock;

	beforeEach(() => {
		clock = 1_000;
	});

	it('loads once and serves the cached data within the TTL', async () => {
		const load = vi.fn(async () => data([1]));
		const cache = createStudyDataCache(load, now);

		const first = await cache.get(7);
		clock += STUDY_DATA_TTL_MS - 1;
		const second = await cache.get(7);

		expect(load).toHaveBeenCalledTimes(1);
		expect(load).toHaveBeenCalledWith(7);
		expect(second).toBe(first);
	});

	it('reloads once the TTL has passed', async () => {
		const load = vi.fn(async () => data());
		const cache = createStudyDataCache(load, now);

		await cache.get(7);
		clock += STUDY_DATA_TTL_MS;
		await cache.get(7);

		expect(load).toHaveBeenCalledTimes(2);
	});

	it('keeps workspaces apart', async () => {
		const load = vi.fn(async (id: number) => data([id]));
		const cache = createStudyDataCache(load, now);

		expect((await cache.get(7)).cards[0].entryId).toBe(7);
		expect((await cache.get(8)).cards[0].entryId).toBe(8);
		await cache.get(7);

		expect(load).toHaveBeenCalledTimes(2);
	});

	it('shares one in-flight load between concurrent callers', async () => {
		const pending = deferred<StudyData>();
		const load = vi.fn(() => pending.promise);
		const cache = createStudyDataCache(load, now);

		const calls = [cache.get(7), cache.get(7), cache.get(7)];
		pending.resolve(data([3]));
		const results = await Promise.all(calls);

		expect(load).toHaveBeenCalledTimes(1);
		expect(results[1]).toBe(results[0]);
		expect(results[2]).toBe(results[0]);
	});

	it('does not cache a failed load', async () => {
		const load = vi
			.fn<(id: number) => Promise<StudyData>>()
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValueOnce(data([1]));
		const cache = createStudyDataCache(load, now);

		await expect(cache.get(7)).rejects.toThrow('offline');
		expect((await cache.get(7)).cards).toHaveLength(1);
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('reloads after invalidate', async () => {
		const load = vi.fn(async () => data());
		const cache = createStudyDataCache(load, now);

		await cache.get(7);
		cache.invalidate(7);
		await cache.get(7);

		expect(load).toHaveBeenCalledTimes(2);
	});

	it('invalidate of one workspace leaves the other cached', async () => {
		const load = vi.fn(async () => data());
		const cache = createStudyDataCache(load, now);

		await cache.get(7);
		await cache.get(8);
		cache.invalidate(7);
		await cache.get(8);

		expect(load).toHaveBeenCalledTimes(2);
	});

	it('does not store a load that was in flight when invalidated', async () => {
		const stale = deferred<StudyData>();
		const load = vi
			.fn<(id: number) => Promise<StudyData>>()
			.mockReturnValueOnce(stale.promise)
			.mockResolvedValueOnce(data([2]));
		const cache = createStudyDataCache(load, now);

		const before = cache.get(7);
		cache.invalidate(7);
		stale.resolve(data([1]));
		// The caller that asked before still gets its answer...
		expect((await before).cards[0].entryId).toBe(1);
		// ...but the next read loads again instead of reusing it.
		expect((await cache.get(7)).cards[0].entryId).toBe(2);
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('force skips the cached data', async () => {
		const load = vi.fn(async () => data());
		const cache = createStudyDataCache(load, now);

		await cache.get(7);
		await cache.get(7, { force: true });

		expect(load).toHaveBeenCalledTimes(2);
	});

	it('invalidate without an id drops every workspace', async () => {
		const load = vi.fn(async () => data());
		const cache = createStudyDataCache(load, now);

		await cache.get(7);
		await cache.get(8);
		cache.invalidate();
		await cache.get(7);
		await cache.get(8);

		expect(load).toHaveBeenCalledTimes(4);
	});
});

describe('hasCard', () => {
	const vocab: StudyCard = {
		id: 'a',
		kind: 'vocab',
		entryId: 42,
		deckIds: ['general'],
		createdAt: '2026-01-01T00:00:00Z'
	};

	it('finds a vocab card of the entry', () => {
		expect(hasCard([vocab], 42)).toBe(true);
		expect(hasCard([vocab], 43)).toBe(false);
		expect(hasCard([], 42)).toBe(false);
	});

	it('ignores sentence cards: the popup adds the vocab card', () => {
		expect(hasCard([{ ...vocab, kind: 'sentence', sentenceId: 3 }], 42)).toBe(false);
	});
});

describe('shared getStudyData', () => {
	function jsonResponse(body: unknown): Response {
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	}

	function pulls(): number {
		return vi
			.mocked(fetch)
			.mock.calls.filter(([url, init]) => String(url).startsWith('/api/sync/pull') && !init?.method?.match(/PUT|DELETE/))
			.length;
	}

	beforeEach(() => {
		vi.stubGlobal('localStorage', {
			getItem: () => null,
			setItem: () => undefined,
			removeItem: () => undefined
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
				init?.method === 'PUT' ? jsonResponse({ version: 1 }) : jsonResponse(pagedPull({ pluginData: [] }))
			)
		);
		workspaces.set({
			list: [],
			current: { id: 7, language: 'zh', name: '', settings: {}, updatedAt: '' }
		});
		invalidateStudyData();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('pulls once for many readers of one workspace', async () => {
		await Promise.all([getStudyData(7), getStudyData(7), getStudyData(7)]);
		await getStudyData(7);
		expect(pulls()).toBe(1);
	});

	it('is invalidated by addCard and createDeck', async () => {
		await getStudyData(7);
		await addCard(42);
		const afterAdd = pulls();
		await getStudyData(7);
		expect(pulls()).toBe(afterAdd + 1);

		await createDeck('HSK 1');
		await getStudyData(7);
		expect(pulls()).toBe(afterAdd + 2);
	});
});
