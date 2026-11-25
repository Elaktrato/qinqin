import { describe, expect, it, vi } from 'vitest';
import { JournalEntries, type JournalEntriesApi } from './journalEntries.svelte';
import type { JournalEntry, Review } from './types';

function entry(id: string, date: string, updatedAt = `${date}T10:00:00Z`): JournalEntry {
	return { id, date, title: id, text: '', source: 'typed', createdAt: updatedAt, updatedAt };
}

function api(list: JournalEntry[] = [], review: Review | null = null): JournalEntriesApi {
	return { list: vi.fn(async () => list), review: vi.fn(async () => review) };
}

describe('JournalEntries', () => {
	it('loads once per instance', async () => {
		const a = api([entry('a', '2026-11-01')]);
		const store = new JournalEntries(a, 1);
		await store.load();
		await store.load();
		expect(a.list).toHaveBeenCalledTimes(1);
		expect(store.items.map((e) => e.id)).toEqual(['a']);
	});

	it('upsert puts a new entry first by date then updatedAt', () => {
		const store = new JournalEntries(api(), 1);
		store.upsert(entry('a', '2026-11-01'));
		store.upsert(entry('c', '2026-11-02', '2026-11-02T08:00:00Z'));
		store.upsert(entry('b', '2026-11-02', '2026-11-02T09:00:00Z'));
		expect(store.items.map((e) => e.id)).toEqual(['b', 'c', 'a']);
		store.upsert(entry('a', '2026-11-03'));
		expect(store.items.map((e) => e.id)).toEqual(['a', 'b', 'c']);
	});

	it('remove drops an entry', () => {
		const store = new JournalEntries(api(), 1);
		store.upsert(entry('a', '2026-11-01'));
		store.remove('a');
		expect(store.items).toEqual([]);
	});

	it('markReviewed sets the flag and the badge load reads reviews', async () => {
		const review = { entryId: 'a' } as Review;
		const a = api([entry('a', '2026-11-01'), entry('b', '2026-11-02')], review);
		const store = new JournalEntries(a, 1);
		await store.load();
		await vi.waitFor(() => expect(store.reviewed.has('a')).toBe(true));
		expect(store.reviewed.has('b')).toBe(true);
		store.markReviewed('c');
		expect(store.reviewed.has('c')).toBe(true);
	});

	it('a load failure shows the catalogue error and retry loads again', async () => {
		const a = api();
		vi.mocked(a.list).mockRejectedValueOnce(new Error('down'));
		const store = new JournalEntries(a, 1);
		await store.load();
		expect(store.error).toBe('Could not load your entries. Try again.');
		vi.mocked(a.list).mockResolvedValue([entry('a', '2026-11-01')]);
		await store.load(true);
		expect(store.error).toBe('');
		expect(store.items).toHaveLength(1);
	});
});
