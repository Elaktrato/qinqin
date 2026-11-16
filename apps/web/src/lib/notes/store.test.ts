import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));

import { NoteTooLongError, deleteNote, loadNote, loadNoteCfg, loadNotes, saveNote, saveNoteCfg } from './store';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const calls = () => vi.mocked(fetch).mock.calls.map(([url, init]) => [String(url), (init as RequestInit | undefined)?.method ?? 'GET', (init as RequestInit | undefined)?.body]);

beforeEach(() => {
	vi.stubGlobal('localStorage', { getItem: () => 'tok', setItem: () => {}, removeItem: () => {} });
	vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('notes store', () => {
	it('loads one note of the workspace without a 404 for a missing one', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			json([
				{ key: 'note:5', data: { version: 1, entryId: 5, text: 'five' } },
				{ key: 'note:50', data: { version: 1, entryId: 50, text: 'fifty' } }
			])
		);
		expect(await loadNote(3, 5)).toEqual({ entryId: 5, text: 'five', extra: {} });
		expect(calls()[0][0]).toBe('/api/plugins/qinqin-core/data?workspace=3&prefix=note%3A5');
		vi.mocked(fetch).mockResolvedValueOnce(json([]));
		expect(await loadNote(3, 6)).toBeNull();
	});

	it('saves a note with PUT to the key route of the workspace', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json({}));
		const prev = { entryId: 5, text: 'old', extra: { attachments: [] } };
		expect(await saveNote(3, 5, 'new\r\ntext  \n', prev)).toEqual({ entryId: 5, text: 'new\ntext', extra: { attachments: [] } });
		const [url, method, body] = calls()[0];
		expect([url, method]).toEqual(['/api/plugins/qinqin-core/data/note:5?workspace=3', 'PUT']);
		expect(JSON.parse(String(body))).toEqual({ attachments: [], version: 1, entryId: 5, text: 'new\ntext' });
	});

	it('saving blank text deletes the note', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
		expect(await saveNote(3, 5, '  \n ', null)).toBeNull();
		expect(calls()[0].slice(0, 2)).toEqual(['/api/plugins/qinqin-core/data/note:5?workspace=3', 'DELETE']);
	});

	it('refuses more than 2000 characters without a request', async () => {
		await expect(saveNote(3, 5, 'a'.repeat(2001), null)).rejects.toBeInstanceOf(NoteTooLongError);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('deletes, and a missing note is fine', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response('not found', { status: 404 }));
		await deleteNote(3, 5);
		expect(calls()[0].slice(0, 2)).toEqual(['/api/plugins/qinqin-core/data/note:5?workspace=3', 'DELETE']);
	});

	it('lists every note of a workspace by entry id', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			json([
				{ key: 'note:1', data: { version: 1, entryId: 1, text: 'one' } },
				{ key: 'note:2', data: { version: 1, entryId: 9, text: 'bad' } }
			])
		);
		expect([...(await loadNotes(4)).entries()]).toEqual([[1, 'one']]);
		expect(calls()[0][0]).toBe('/api/plugins/qinqin-core/data?workspace=4&prefix=note%3A');
	});

	it('reads and writes notecfg', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json([{ key: 'notecfg', data: { version: 1, onAnswer: false, x: 1 } }]));
		const cfg = await loadNoteCfg(4);
		expect(cfg).toEqual({ onAnswer: false, extra: { x: 1 } });
		expect(calls()[0][0]).toBe('/api/plugins/qinqin-core/data?workspace=4&prefix=notecfg');
		vi.mocked(fetch).mockResolvedValueOnce(json({}));
		await saveNoteCfg(4, true, cfg);
		const [url, method, body] = calls()[1];
		expect([url, method]).toEqual(['/api/plugins/qinqin-core/data/notecfg?workspace=4', 'PUT']);
		expect(JSON.parse(String(body))).toEqual({ x: 1, version: 1, onAnswer: true });
		vi.mocked(fetch).mockResolvedValueOnce(json([]));
		expect(await loadNoteCfg(4)).toEqual({ onAnswer: true, extra: {} });
	});
});
