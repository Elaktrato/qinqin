import { describe, expect, it } from 'vitest';
import { deriveProgress } from './progress';
import { MAX_PENDING, clearDropped, flushPending, mergeLog, readDropped, readPending, withoutSent, writePending } from './pending';
import { scriptPayload } from './events';

function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
		removeItem: (k) => void data.delete(k)
	};
}

const ev = (id: string, ok = true, ws = 3) => ({
	id,
	workspaceId: ws,
	device: 'web',
	ts: '2026-11-26T10:00:00.000Z',
	type: 'script',
	payload: scriptPayload('hangul', 'hangul:ㄱ', 'recognise', ok)
});

describe('pending answers', () => {
	it('round-trips a workspace list and keeps workspaces apart', () => {
		const s = memory();
		writePending(s, 3, [ev('a'), ev('b')]);
		expect(readPending(s, 3).map((e) => e.id)).toEqual(['a', 'b']);
		expect(readPending(s, 4)).toEqual([]);
	});

	it('never drops past the limit silently: the dropped count is kept for a warning until cleared', () => {
		const s = memory();
		const list = Array.from({ length: MAX_PENDING + 3 }, (_, i) => ev(`e${i}`));
		expect(writePending(s, 3, list)).toBe(3);
		expect(readPending(s, 3)).toHaveLength(MAX_PENDING);
		expect(readPending(s, 3)[0].id).toBe('e3');
		expect(readDropped(s, 3)).toBe(3);
		expect(readDropped(s, 4)).toBe(0);
		clearDropped(s, 3);
		expect(readDropped(s, 3)).toBe(0);
	});

	it('flushPending sends what waits, removes what was taken and keeps it when the post fails', async () => {
		const s = memory();
		writePending(s, 3, [ev('a'), ev('b')]);
		expect(await flushPending(s, 3, () => Promise.reject(new Error('offline')))).toBe(false);
		expect(readPending(s, 3)).toHaveLength(2);
		let sent: string[] = [];
		expect(await flushPending(s, 3, async (events) => void (sent = events.map((e) => e.id)))).toBe(true);
		expect(sent).toEqual(['a', 'b']);
		expect(readPending(s, 3)).toEqual([]);
	});

	it('flushPending runs once at a time per workspace', async () => {
		const s = memory();
		writePending(s, 3, [ev('a')]);
		let release = () => {};
		let calls = 0;
		const post = () => new Promise<void>((r) => { calls += 1; release = r; });
		const first = flushPending(s, 3, post);
		await flushPending(s, 3, post);
		release();
		await first;
		expect(calls).toBe(1);
	});

	it('removes the key when the list is empty', () => {
		const s = memory();
		writePending(s, 3, [ev('a')]);
		writePending(s, 3, []);
		expect(s.data.size).toBe(0);
	});

	it('survives no storage, junk and a storage that throws', () => {
		expect(readPending(null, 3)).toEqual([]);
		const s = memory();
		s.setItem('qinqin.scripts.pending.3', '{nope');
		expect(readPending(s, 3)).toEqual([]);
		s.setItem('qinqin.scripts.pending.3', JSON.stringify([ev('a'), { type: 'review' }, ev('b', true, 9), 7]));
		expect(readPending(s, 3).map((e) => e.id)).toEqual(['a']);
		const bad = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
		expect(readPending(bad, 3)).toEqual([]);
		expect(() => writePending(bad, 3, [ev('a')])).not.toThrow();
	});

	it('drops what was sent, and merges only what the log lacks', () => {
		expect(withoutSent([ev('a'), ev('b')], new Set(['a'])).map((e) => e.id)).toEqual(['b']);
		const log = [ev('a')];
		expect(mergeLog(log, [ev('a'), ev('b')]).map((e) => e.id)).toEqual(['a', 'b']);
	});

	it('counts a waiting answer in the progress', () => {
		const merged = mergeLog([], [ev('a', true)]);
		expect(deriveProgress(merged).get('hangul:ㄱ')?.correct).toBe(1);
	});
});
