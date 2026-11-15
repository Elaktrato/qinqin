import { beforeEach, describe, expect, it, vi } from 'vitest';

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
	const result: StudyCard = {
		id,
		kind: 'vocab',
		entryId,
		deckIds: ['general'],
		createdAt: '2025-01-01T00:00:00.000Z'
	};
	if (written !== undefined) result.written = written;
	return result;
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

	// A frame scheduler the test steps by hand.
	function manualFrames() {
		let pending: (() => void) | null = null;
		return {
			schedule: (cb: () => void) => {
				pending = cb;
			},
			hasPending: () => pending !== null,
			frame: () => {
				const cb = pending;
				pending = null;
				cb?.();
			}
		};
	}

	it('publishes a 500-card backfill a handful of times, not 500', async () => {
		getEntryMock.mockImplementation(async (id) => entry(`字${id}`));
		const frames = manualFrames();
		let publishes = 0;
		let last: StudyCard[] = [];

		const result = await fillMissingWrittenProgressively(
			legacyDeck(500),
			(next) => {
				publishes += 1;
				last = next;
			},
			{ schedule: frames.schedule }
		);

		// Before coalescing this was 500 (one mastery pass each).
		expect(publishes).toBeLessThanOrEqual(2);
		expect(last.every((c) => c.written !== undefined)).toBe(true);
		expect(result.unresolvedCards).toBe(0);
	});

	it('publishes at most once per frame while entries keep resolving', async () => {
		let release: Array<() => void> = [];
		getEntryMock.mockImplementation(
			(id) =>
				new Promise<Entry>((resolve) => {
					release.push(() => resolve(entry(`字${id}`)));
				})
		);
		const frames = manualFrames();
		const snapshots: number[] = [];
		const run = fillMissingWrittenProgressively(
			legacyDeck(8),
			(next) => snapshots.push(next.filter((c) => c.written !== undefined).length),
			{ schedule: frames.schedule }
		);

		// Resolve the first four in flight, then let a frame pass.
		await vi.waitFor(() => expect(release).toHaveLength(4));
		const first = release;
		release = [];
		first.forEach((r) => r());
		await vi.waitFor(() => expect(release).toHaveLength(4));
		expect(snapshots).toEqual([]);
		expect(frames.hasPending()).toBe(true);
		frames.frame();
		expect(snapshots).toEqual([4]);

		release.forEach((r) => r());
		await run;
		expect(snapshots.at(-1)).toBe(8);
		expect(snapshots.length).toBeLessThanOrEqual(3);
	});

	it('does not publish after the run resolves', async () => {
		getEntryMock.mockResolvedValue(entry('猫'));
		const frames = manualFrames();
		let publishes = 0;
		await fillMissingWrittenProgressively([card('a', 1)], () => (publishes += 1), {
			schedule: frames.schedule
		});
		const before = publishes;
		frames.frame();
		expect(publishes).toBe(before);
	});

	it('publishes cached resolutions once and does not refetch them', async () => {
		getEntryMock.mockImplementation(async (id) => entry(`字${id}`));
		await fillMissingWritten(legacyDeck(50));
		getEntryMock.mockClear();

		let publishes = 0;
		const frames = manualFrames();
		await fillMissingWrittenProgressively(legacyDeck(50), () => (publishes += 1), {
			schedule: frames.schedule
		});

		expect(publishes).toBe(1);
		expect(getEntryMock).not.toHaveBeenCalled();
	});
});
