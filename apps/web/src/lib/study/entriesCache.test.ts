import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getEntry } from '../api/entries';
import type { Entry } from '../api/types';
import {
	clearEntriesCache,
	fillMissingWritten,
	fillMissingWrittenProgressively,
	missingWrittenEntryIds,
	withWritten
} from './entriesCache';
import type { StudyCard } from './types';
import * as build from '$lib/testing/study';

vi.mock('../api/entries', () => ({ getEntry: vi.fn() }));

const getEntryMock = vi.mocked(getEntry);

function entry(written: string): Entry {
	return { written } as Entry;
}

beforeEach(() => {
	clearEntriesCache();
	getEntryMock.mockReset();
});

function card(id: string, entryId: number, written?: string): StudyCard {
	return build.card({ id, entryId, written, createdAt: '2025-01-01T00:00:00.000Z' });
}

describe('missingWrittenEntryIds', () => {
	it('lists unique entry ids of cards without a snapshot', () => {
		const cards = [
			card('c1', 10, '猫'),
			card('c2', 11),
			card('c3', 11),
			card('c4', 12, '')
		];

		expect(missingWrittenEntryIds(cards)).toEqual([11]);
	});

	it('reports nothing when every card has a snapshot', () => {
		expect(missingWrittenEntryIds([card('c1', 10, '猫'), card('c2', 11, '')])).toEqual([]);
	});
});

describe('withWritten', () => {
	it('fills only cards without a snapshot', () => {
		const resolved = new Map<number, string | null>([
			[10, '狗'],
			[11, null]
		]);
		const cards = [card('known', 10, '猫'), card('legacy', 10), card('missing', 11)];

		const filled = withWritten(cards, resolved);

		expect(filled[0].written).toBe('猫');
		expect(filled[1]).toEqual({ ...cards[1], written: '狗' });
		expect(filled[2].written).toBeUndefined();
	});

	it('leaves a card untouched when its entry could not be resolved', () => {
		const cards = [card('legacy', 11)];

		expect(withWritten(cards, new Map([[11, null]]))).toEqual(cards);
	});

	it('does not mutate the input cards', () => {
		const legacy = card('legacy', 10);
		withWritten([legacy], new Map([[10, '狗']]));

		expect(legacy).toEqual(card('legacy', 10));
	});
});

describe('fillMissingWrittenProgressively', () => {
	it('publishes cards as each entry resolves', async () => {
		let release: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		getEntryMock.mockImplementation(async (entryId) => {
			if (entryId === 11) await gate;
			return entry(entryId === 10 ? '猫' : '狗');
		});

		const cards = [card('first', 10), card('second', 11)];
		const snapshots: string[] = [];
		const run = fillMissingWrittenProgressively(cards, (next) => {
			snapshots.push(next.map((item) => item.written ?? '?').join(','));
		});

		await vi.waitFor(() => expect(snapshots).toHaveLength(1));
		expect(snapshots[0]).toBe('猫,?');

		release();
		const result = await run;

		expect(snapshots.at(-1)).toBe('猫,狗');
		expect(result.unresolvedCards).toBe(0);
	});

	it('counts cards that could not be resolved', async () => {
		getEntryMock.mockRejectedValue(new Error('offline'));

		const result = await fillMissingWrittenProgressively(
			[card('first', 10), card('second', 11)],
			() => {}
		);

		expect(result.unresolvedCards).toBe(2);
	});

	it('does not cache a failed lookup and retries it next load', async () => {
		getEntryMock
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValueOnce(entry('猫'));

		const first = await fillMissingWritten([card('legacy', 10)]);
		const second = await fillMissingWritten([card('legacy', 10)]);

		expect(first[0].written).toBeUndefined();
		expect(second[0].written).toBe('猫');
		expect(getEntryMock).toHaveBeenCalledTimes(2);
	});

	it('caches a successful resolution across loads', async () => {
		getEntryMock.mockResolvedValue(entry('猫'));

		await fillMissingWritten([card('legacy', 10)]);
		await fillMissingWritten([card('legacy', 10)]);

		expect(getEntryMock).toHaveBeenCalledTimes(1);
	});
});

describe('backfill coalescing', () => {
	function legacyDeck(n: number): StudyCard[] {
		return Array.from({ length: n }, (_, i) => card(`c${i}`, i + 1));
	}

	afterEach(() => {
		vi.useRealTimers();
	});

	it('publishes a 500-card backfill about once per interval, not 500 times', async () => {
		vi.useFakeTimers();
		// Realistic latency: 50 ms per fetch, 4 in flight -> 500 entries
		// take 500 / 4 * 50 = 6250 ms.
		getEntryMock.mockImplementation(
			(id) => new Promise<Entry>((resolve) => setTimeout(() => resolve(entry(`字${id}`)), 50))
		);
		let publishes = 0;
		let last: StudyCard[] = [];
		const run = fillMissingWrittenProgressively(legacyDeck(500), (next) => {
			publishes += 1;
			last = next;
		});
		await vi.advanceTimersByTimeAsync(10_000);
		const result = await run;

		// Before throttling this was 500 (one mastery pass each).
		const durationMs = 6250;
		expect(publishes).toBeLessThanOrEqual(durationMs / 250 + 2);
		expect(publishes).toBeGreaterThan(1);
		expect(last.every((c) => c.written !== undefined)).toBe(true);
		expect(result.unresolvedCards).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('publishes the first resolution at once and the rest as one trailing batch', async () => {
		vi.useFakeTimers();
		getEntryMock.mockImplementation(
			(id) => new Promise<Entry>((resolve) => setTimeout(() => resolve(entry(`字${id}`)), 10 * id))
		);
		const snapshots: number[] = [];
		const run = fillMissingWrittenProgressively(
			legacyDeck(4),
			(next) => snapshots.push(next.filter((c) => c.written !== undefined).length)
		);
		await vi.advanceTimersByTimeAsync(11);
		expect(snapshots).toEqual([1]);
		await vi.advanceTimersByTimeAsync(100);
		await run;
		expect(snapshots).toEqual([1, 4]);
	});

	it('does not publish or leave a timer after the run resolves', async () => {
		vi.useFakeTimers();
		getEntryMock.mockResolvedValue(entry('猫'));
		let publishes = 0;
		await fillMissingWrittenProgressively(
			[card('a', 1), card('b', 2)],
			() => (publishes += 1)
		);
		const before = publishes;
		await vi.advanceTimersByTimeAsync(1000);
		expect(publishes).toBe(before);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('publishes cached resolutions once and does not refetch them', async () => {
		getEntryMock.mockImplementation(async (id) => entry(`字${id}`));
		await fillMissingWritten(legacyDeck(50));
		getEntryMock.mockClear();

		let publishes = 0;
		await fillMissingWrittenProgressively(legacyDeck(50), () => (publishes += 1));

		expect(publishes).toBe(1);
		expect(getEntryMock).not.toHaveBeenCalled();
	});

	it('does not publish when every cached resolution has no written form', async () => {
		getEntryMock.mockResolvedValue(entry(''));
		await fillMissingWritten([card('a', 1)]);
		let publishes = 0;
		await fillMissingWrittenProgressively([card('a', 1)], () => (publishes += 1));
		expect(publishes).toBe(0);
	});
});
