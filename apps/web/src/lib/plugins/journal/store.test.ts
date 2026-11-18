import { studyDay } from '../../time/studyDay';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import {
	JOURNAL_PLUGIN_ID,
	deleteEntry,
	getEntry,
	getJournalSettings,
	getReview,
	getSuggestions,
	listEntries,
	newEntry,
	saveEntry,
	saveJournalSettings
} from './store';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

function row(key: string, data: unknown) {
	return { pluginId: JOURNAL_PLUGIN_ID, key, workspaceId: 3, data, deletedAt: null };
}

function entry(id: string, date: string, updatedAt: string) {
	return { id, date, title: id, text: 'text', source: 'typed', createdAt: updatedAt, updatedAt };
}

describe('journal store', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('lists entries by prefix, newest date then newest update first', async () => {
		vi.mocked(fetch).mockResolvedValue(
			json([
				row('entry:a', entry('a', '2026-11-01', '2026-11-01T10:00:00Z')),
				row('entry:b', entry('b', '2026-11-02', '2026-11-02T08:00:00Z')),
				row('entry:c', entry('c', '2026-11-02', '2026-11-02T09:00:00Z'))
			])
		);
		const list = await listEntries(3);
		expect(list.map((e) => e.id)).toEqual(['c', 'b', 'a']);
		const url = vi.mocked(fetch).mock.calls[0][0] as string;
		expect(url).toContain('/api/plugins/qinqin-journal/data?');
		expect(url).toContain('workspace=3');
		expect(url).toContain('prefix=entry%3A');
	});

	it('skips malformed rows and decodes string data', async () => {
		vi.mocked(fetch).mockResolvedValue(
			json([
				row('entry:a', entry('other', '2026-11-01', 'x')),
				row('entry:b', { ...entry('b', '2026-11-01', 'x'), text: 5 }),
				row('entry:c', 'not json'),
				row('entry:d', JSON.stringify(entry('d', '2026-11-01', 'x'))),
				row('entry:e', null)
			])
		);
		expect((await listEntries(3)).map((e) => e.id)).toEqual(['d']);
	});

	it('gets one entry, null when missing or malformed', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json(row('entry:a', entry('a', '2026-11-01', 'x'))));
		expect((await getEntry(3, 'a'))?.id).toBe('a');
		expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/plugins/qinqin-journal/data/entry:a?workspace=3');
		vi.mocked(fetch).mockResolvedValueOnce(new Response('not found', { status: 404 }));
		expect(await getEntry(3, 'a')).toBeNull();
	});

	it('saves an entry with a fresh updatedAt', async () => {
		vi.mocked(fetch).mockResolvedValue(json({}));
		const before = entry('a', '2026-11-01', '2020-01-01T00:00:00.000Z') as ReturnType<typeof newEntry>;
		const saved = await saveEntry(3, before);
		expect(saved.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe('/api/plugins/qinqin-journal/data/entry:a?workspace=3');
		expect(init?.method).toBe('PUT');
		expect(JSON.parse(init?.body as string)).toEqual(saved);
	});

	it("dates a new entry by the learner's day, not the browser's", () => {
		const tokyo = studyDay([{ zone: 'Asia/Tokyo', from: null }]);
		expect(newEntry('typed', tokyo, new Date('2026-11-05T15:30:00Z')).date).toBe('2026-11-06');
		expect(newEntry('typed', tokyo, new Date('2026-11-05T14:30:00Z')).date).toBe('2026-11-05');
		expect(newEntry('typed', studyDay([]), new Date('2026-11-05T23:30:00Z')).date).toBe('2026-11-05');
	});

	it('creates entries with a ULID and the learner date', () => {
		const e = newEntry('photo', studyDay([]), new Date('2026-11-05T23:30:00Z'));
		expect(e.id).toMatch(/^[0-9A-Z]{26}$/);
		expect(e.date).toBe('2026-11-05');
		expect(e.source).toBe('photo');
		expect(e.text).toBe('');
		expect(e.createdAt).toBe(e.updatedAt);
	});

	it('deletes the entry and its review, tolerating a 404', async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(new Response('not found', { status: 404 }));
		await deleteEntry(3, 'a');
		const calls = vi.mocked(fetch).mock.calls;
		expect(calls.map((c) => [c[0], c[1]?.method])).toEqual([
			['/api/plugins/qinqin-journal/data/entry:a?workspace=3', 'DELETE'],
			['/api/plugins/qinqin-journal/data/review:a?workspace=3', 'DELETE']
		]);
	});

	it('reads the review and suggestions through the list route, null when absent', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json([row('review:a', { entryId: 'a', annotations: [{ id: 'a1', quote: 'x', correction: 'y' }] })]));
		const review = await getReview(3, 'a');
		expect(review?.entryId).toBe('a');
		expect(review?.annotations[0].kind).toBe('mistake');
		vi.mocked(fetch).mockResolvedValueOnce(json([row('review:b', { annotations: [] })]));
		expect(await getReview(3, 'b')).toBeNull();
		expect(vi.mocked(fetch).mock.calls[0][0]).toContain('prefix=review%3Aa');
		vi.mocked(fetch).mockResolvedValueOnce(json([]));
		expect(await getSuggestions(3)).toBeNull();
		expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3); // no 404 requests
	});

	it('applies settings defaults for no row, bad data and an unknown language', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json([]));
		expect(await getJournalSettings(3)).toEqual({ guidance: '', explanationLanguage: 'en' });
		vi.mocked(fetch).mockResolvedValueOnce(json([row('settings', 42)]));
		expect(await getJournalSettings(3)).toEqual({ guidance: '', explanationLanguage: 'en' });
		vi.mocked(fetch).mockResolvedValueOnce(json([row('settings', { guidance: 'be kind', explanationLanguage: 'klingon' })]));
		expect(await getJournalSettings(3)).toEqual({ guidance: 'be kind', explanationLanguage: 'en' });
		vi.mocked(fetch).mockResolvedValueOnce(json([row('settings', { guidance: 'g', explanationLanguage: 'de' })]));
		expect(await getJournalSettings(3)).toEqual({ guidance: 'g', explanationLanguage: 'de' });
	});

	it('saves settings', async () => {
		vi.mocked(fetch).mockResolvedValue(json({}));
		await saveJournalSettings(3, { guidance: 'g', explanationLanguage: 'de' });
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe('/api/plugins/qinqin-journal/data/settings?workspace=3');
		expect(init?.method).toBe('PUT');
	});

	it('saves with keepalive for a small entry when asked, and without for a large one', async () => {
		vi.mocked(fetch).mockImplementation(async () => json({}));
		await saveEntry(3, { ...newEntry('typed', studyDay([])), text: 'short' }, { keepalive: true });
		expect(vi.mocked(fetch).mock.calls[0][1]?.keepalive).toBe(true);
		await saveEntry(3, { ...newEntry('typed', studyDay([])), text: 'x'.repeat(70000) }, { keepalive: true });
		expect(vi.mocked(fetch).mock.calls[1][1]?.keepalive).toBeFalsy();
		await saveEntry(3, newEntry('typed', studyDay([])));
		expect(vi.mocked(fetch).mock.calls[2][1]?.keepalive).toBeFalsy();
	});
});
