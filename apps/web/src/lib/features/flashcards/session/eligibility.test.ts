import { describe, expect, it, vi } from 'vitest';
import { ELIGIBILITY_BATCH, ELIGIBILITY_TTL_MS, EligibilityIndex } from './eligibility.svelte';

function index(answer: (ids: number[]) => Record<string, string[]> | Promise<Record<string, string[]>>) {
	let now = 1_000_000;
	const fetch = vi.fn(async (ids: number[]) => answer(ids));
	const idx = new EligibilityIndex({ fetch, now: () => now });
	return { idx, fetch, advance: (ms: number) => (now += ms) };
}

const all = (ids: number[]) => Object.fromEntries(ids.map((id) => [String(id), ['sentence', 'writing', 'tone', 'reverse', 'cloze']]));

describe('EligibilityIndex', () => {
	it('rules out the kinds the server did not list, for known entries only', async () => {
		const { idx } = index(() => ({ '1': ['reverse'], '2': ['sentence', 'cloze'] }));
		expect(idx.knows(1)).toBe(false);
		await idx.ensure([1, 2]);
		const skip = idx.skip();
		expect(skip.has('sentence:1')).toBe(true);
		expect(skip.has('cloze:1')).toBe(true);
		expect(skip.has('tone:1')).toBe(true);
		expect(skip.has('reverse:1')).toBe(false);
		expect(skip.has('sentence:2')).toBe(false);
		expect(skip.has('reverse:2')).toBe(true);
		expect(skip.has('writing:1')).toBe(true);
		// Vocab is never ruled out; an unknown entry is not ruled out.
		expect(skip.has('vocab:1')).toBe(false);
		expect(skip.has('sentence:3')).toBe(false);
		expect(idx.knows(1)).toBe(true);
		expect(idx.knows(3)).toBe(false);
	});

	it('asks only for what it does not know, in batches, once while a request runs', async () => {
		const { idx, fetch } = index(all);
		const ids = Array.from({ length: ELIGIBILITY_BATCH + 10 }, (_, i) => i + 1);
		await Promise.all([idx.ensure(ids), idx.ensure(ids)]);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls[0][0]).toHaveLength(ELIGIBILITY_BATCH);
		expect(fetch.mock.calls[1][0]).toHaveLength(10);
		await idx.ensure([1, 2, 3]);
		expect(fetch).toHaveBeenCalledTimes(2);
		await idx.ensure([1, ELIGIBILITY_BATCH + 11]);
		expect(fetch).toHaveBeenCalledTimes(3);
		expect(fetch.mock.calls[2][0]).toEqual([ELIGIBILITY_BATCH + 11]);
	});

	it('an id the answer leaves out is known to have nothing', async () => {
		const { idx } = index(() => ({}));
		await idx.ensure([5]);
		expect(idx.knows(5)).toBe(true);
		expect(idx.skip().has('reverse:5')).toBe(true);
	});

	it('a failed request leaves the entries unknown and is asked again', async () => {
		let fail = true;
		const { idx, fetch } = index((ids) => {
			if (fail) throw new TypeError('offline');
			return all(ids);
		});
		await idx.ensure([1]);
		expect(idx.knows(1)).toBe(false);
		expect(idx.skip().has('sentence:1')).toBe(false);
		fail = false;
		await idx.ensure([1]);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(idx.knows(1)).toBe(true);
	});

	it('asks again after the time to live (in the background, the old answer serves) and after forget', async () => {
		let answer: Record<string, string[]> = { '1': ['sentence'] };
		let release = () => {};
		const { idx, fetch, advance } = index(async () => answer);
		await idx.ensure([1]);
		advance(ELIGIBILITY_TTL_MS - 1);
		await idx.ensure([1]);
		expect(fetch).toHaveBeenCalledTimes(1);
		advance(2);
		answer = { '1': ['reverse'] };
		fetch.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(answer))));
		await idx.ensure([1]);
		expect(fetch).toHaveBeenCalledTimes(2);
		// Not waited for: the old answer still serves.
		expect(idx.allows('sentence', 1)).toBe(true);
		release();
		await vi.waitFor(() => expect(idx.allows('reverse', 1)).toBe(true));
		expect(idx.allows('sentence', 1)).toBe(false);
		idx.forget(1);
		expect(idx.knows(1)).toBe(false);
		await idx.ensure([1]);
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('a drop when shown rules the kind out until the entry is forgotten', async () => {
		const { idx } = index(all);
		await idx.ensure([1]);
		const before = idx.version;
		idx.ruleOut('sentence', 1);
		idx.ruleOut('writing', 2);
		expect(idx.version).toBeGreaterThan(before);
		expect(idx.skip().has('sentence:1')).toBe(true);
		expect(idx.skip().has('writing:2')).toBe(true);
		expect(idx.skip().has('cloze:1')).toBe(false);
		idx.forget(1);
		expect(idx.skip().has('sentence:1')).toBe(false);
	});

	it('clear forgets everything (the session end)', async () => {
		const { idx } = index(() => ({ '1': [] }));
		await idx.ensure([1]);
		idx.clear();
		expect(idx.knows(1)).toBe(false);
		expect(idx.skip().size).toBe(0);
	});
});

describe('companionEntryIds', () => {
	it('lists the entries of the vocab cards once', async () => {
		const { companionEntryIds } = await import('./eligibility.svelte');
		expect(
			companionEntryIds([
				{ kind: 'vocab', entryId: 1 },
				{ kind: 'sentence', entryId: 2 },
				{ kind: 'vocab', entryId: 1 },
				{ kind: 'vocab', entryId: 3 }
			])
		).toEqual([1, 3]);
	});
});
