import { describe, expect, it } from 'vitest';
import { deriveProgress } from './progress';
import { mergeLog, readPending, withoutSent, writePending } from './pending';
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
