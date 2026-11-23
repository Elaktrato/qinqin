// docs/contracts/sync/unreadable-rows.json through the study load: one page
// with an unreadable row of every typed family (malformed, or from a newer
// client) loads the readable rows, reports the others, and no write ever
// replaces a row this version could not read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

import fixture from '../../../../../docs/contracts/sync/unreadable-rows.json';
import { parsePullPage } from '../sync/pager';
import { STUDY_COLLECTIONS, type StudyCollection } from './rows';
import {
	UnreadableRowError,
	addCard,
	deleteDeck,
	loadRawStudyData,
	loadStudyData,
	saveDeckCardTypes,
	saveDeckLimits,
	saveWorkspaceLimits,
	setActiveSet
} from './store';
import { clearUnreadableReport, unreadableRows } from './unreadable';

const WS = 7;
type Rows = Record<string, { _why: string; row: unknown }[]>;
const rows = fixture.rows as Rows;
const page = {
	...fixture.envelope,
	collections: Object.fromEntries(Object.entries(rows).map(([name, list]) => [name, list.map((r) => r.row)]))
};
const protectedKeys = Object.entries(fixture.expect.protected).flatMap(([c, ids]) => (ids as string[]).map((id) => `${c}:${id}`));

function pushes(): Record<string, Record<string, unknown>[]>[] {
	return vi
		.mocked(fetch)
		.mock.calls.filter(([url, init]) => String(url) === '/api/sync/push' && init?.method === 'POST')
		.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, Record<string, unknown>[]>);
}

function identityOfItem(collection: StudyCollection, item: Record<string, unknown>): string {
	if (collection === 'deckSettings') return String(item.deckId);
	if (collection === 'limits') return item.deckId === null ? '' : String(item.deckId);
	if (collection === 'fsrsActive') return '';
	return String(item.id);
}

function pushedKeys(): string[] {
	return pushes().flatMap((body) =>
		STUDY_COLLECTIONS.flatMap((c) => (body[c] ?? []).map((item) => `${c}:${identityOfItem(c, item)}`))
	);
}

beforeEach(() => {
	clearUnreadableReport();
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: unknown, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith('/api/events')) return Response.json([]);
			if (url === '/api/sync/push') {
				const body = JSON.parse(String(init?.body)) as Record<string, unknown[]>;
				const n = Object.values(body).reduce((sum, list) => sum + list.length, 0);
				return Response.json({ eventsAccepted: 0, eventDuplicates: 0, dataAccepted: n, dataSkipped: 0, dataRefused: 0 });
			}
			if (url.startsWith('/api/sync/pull')) return Response.json(page);
			return new Response('unexpected', { status: 500 });
		})
	);
});

afterEach(() => {
	// Whatever a test did: no write named a row this version could not read.
	for (const key of pushedKeys()) expect(protectedKeys, key).not.toContain(key);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('docs/contracts/sync/unreadable-rows.json', () => {
	it('the page envelope decodes (rows are not the pager\'s)', () => {
		expect(parsePullPage(page, fixture.requested)).not.toBeNull();
	});

	it('loads exactly the readable rows and reports the unreadable ones', async () => {
		const data = await loadStudyData(WS);
		const want = fixture.expect.readable;
		expect(data.cards.map((c) => c.id)).toEqual(want.cards);
		expect(data.decks.map((d) => d.id)).toEqual(want.decks);
		expect(Object.keys(data.deckSettings ?? {})).toEqual(want.deckSettings);
		expect(Object.keys(data.limits?.decks ?? {})).toEqual(want.limits);
		expect(data.limits?.workspace ?? null).toBeNull();
		expect((data.fsrs?.sets ?? []).map((s) => s.id)).toEqual(want.fsrsSets);
		expect(data.fsrs?.pointer ?? null).toBeNull();
		expect(data.known).toEqual([1201]);
		const report = get(unreadableRows);
		expect(report?.workspaceId).toBe(WS);
		expect(report?.counts).toEqual(fixture.expect.unreadable);
		expect(report?.total).toBe(Object.values(fixture.expect.unreadable).reduce((a, b) => a + b, 0));
		// One warning, identities only: no row data reaches the console.
		expect(console.warn).toHaveBeenCalledTimes(1);
		const warned = JSON.stringify(vi.mocked(console.warn).mock.calls[0]);
		for (const key of protectedKeys) expect(warned).toContain(key);
		expect(warned).not.toContain('difficulty');
		expect(warned).not.toContain('hsk-1');
	});

	it('remembers every protected identity for write planning', async () => {
		const raw = await loadRawStudyData(WS);
		expect([...raw.unreadable].sort()).toEqual([...protectedKeys].sort());
	});

	it('refuses writes that would replace an unreadable row, before any push', async () => {
		const deck = fixture.expect.protected.deckSettings[0];
		await expect(saveDeckCardTypes(WS, deck, ['reverse'])).rejects.toBeInstanceOf(UnreadableRowError);
		await expect(saveWorkspaceLimits(WS, { new: 3 })).rejects.toBeInstanceOf(UnreadableRowError);
		await expect(setActiveSet(WS, fixture.expect.readable.fsrsSets[0])).rejects.toBeInstanceOf(UnreadableRowError);
		expect(pushes()).toEqual([]);
	});

	it('writes a readable row of the same collection as before', async () => {
		await saveDeckLimits(WS, 'general', { new: 8 });
		expect(pushedKeys()).toEqual(['limits:general']);
	});

	it('a new card never takes the id of an unreadable card', async () => {
		const added = await addCard(WS, 1203);
		expect(added.id).not.toBe('c-vocab-1203');
		expect(pushedKeys()).toEqual([`cards:${added.id}`]);
	});

	it('deleting a deck leaves its unreadable settings row untouched', async () => {
		await deleteDeck(WS, fixture.expect.readable.decks[0]);
		expect(pushedKeys()).toContain(`decks:${fixture.expect.readable.decks[0]}`);
		expect(pushedKeys().filter((k) => k.startsWith('deckSettings:'))).toEqual([]);
	});
});
