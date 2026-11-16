import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseLookups } from './lookups';
import { FLUSH_IDLE_MS, FLUSH_MAX_MS, LookupRecorder, RECORDER_BUFFER_MAX, type RecorderIO } from './recorder';

interface Fake extends RecorderIO {
	rows: Map<number, unknown>;
	cfg: unknown;
	log: string[];
	failWrites: number;
}

function fakeIO(): Fake {
	const io: Fake = {
		rows: new Map(),
		cfg: null,
		log: [],
		failWrites: 0,
		async readRow(ws) {
			io.log.push(`read ${ws}`);
			return io.rows.get(ws) ?? null;
		},
		async writeRow(ws, data) {
			io.log.push(`write ${ws}`);
			if (io.failWrites > 0) {
				io.failWrites--;
				throw new Error('offline');
			}
			io.rows.set(ws, JSON.parse(JSON.stringify(data)));
		},
		async readCfg() {
			io.log.push('cfg');
			return io.cfg;
		}
	};
	return io;
}

const items = (io: Fake, ws: number) => parseLookups(io.rows.get(ws) ?? null).items;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-11-16T09:00:00Z'));
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('LookupRecorder', () => {
	it('flushes 5 s after the last lookup', async () => {
		const io = fakeIO();
		const r = new LookupRecorder(io);
		expect(FLUSH_IDLE_MS).toBe(5000);
		r.note(3, { entryId: 7, source: 'reader', bookId: 2 });
		await vi.advanceTimersByTimeAsync(4000);
		r.note(3, { entryId: 8, source: 'reader', bookId: 2 });
		await vi.advanceTimersByTimeAsync(4999);
		expect(io.log).toEqual([]);
		await vi.advanceTimersByTimeAsync(1);
		expect(io.log).toEqual(['cfg', 'read 3', 'write 3']);
		expect(items(io, 3).map((i) => i.entryId).sort()).toEqual([7, 8]);
	});

	it('forces a flush 30 s after the first lookup', async () => {
		const io = fakeIO();
		const r = new LookupRecorder(io);
		expect(FLUSH_MAX_MS).toBe(30_000);
		for (let t = 0; t < 30; t += 3) {
			r.note(3, { entryId: 100 + t, source: 'reader' });
			await vi.advanceTimersByTimeAsync(3000);
		}
		expect(io.log).toContain('write 3');
		expect(io.log.filter((l) => l === 'write 3')).toHaveLength(1);
	});

	it('always reads the row before writing it, and merges into what it read', async () => {
		const io = fakeIO();
		const r = new LookupRecorder(io);
		r.note(3, { entryId: 7, source: 'reader' });
		await r.flush();
		// another device writes meanwhile
		io.rows.set(3, { version: 1, clearedAt: null, items: [{ entryId: 99, count: 1, firstAt: '2026-11-16T09:00:01Z', lastAt: '2026-11-16T09:00:01Z', sources: {}, books: [] }] });
		r.note(3, { entryId: 8, source: 'search' });
		await r.flush();
		expect(io.log).toEqual(['cfg', 'read 3', 'write 3', 'cfg', 'read 3', 'write 3']);
		expect(items(io, 3).map((i) => i.entryId).sort((a, b) => a - b)).toEqual([8, 99]);
	});

	it('flushes each workspace separately', async () => {
		const io = fakeIO();
		const r = new LookupRecorder(io);
		r.note(3, { entryId: 7, source: 'reader' });
		r.note(4, { entryId: 8, source: 'lesson' });
		await r.flush();
		expect(items(io, 3).map((i) => i.entryId)).toEqual([7]);
		expect(items(io, 4).map((i) => i.entryId)).toEqual([8]);
	});

	it('a failed write keeps the buffer for the next flush', async () => {
		const io = fakeIO();
		const r = new LookupRecorder(io);
		io.failWrites = 1;
		r.note(3, { entryId: 7, source: 'reader' });
		await r.flush();
		expect(io.rows.has(3)).toBe(false);
		await r.flush();
		expect(items(io, 3).map((i) => i.entryId)).toEqual([7]);
	});

	it('a failed write retries on its own later', async () => {
		const io = fakeIO();
		const r = new LookupRecorder(io);
		io.failWrites = 1;
		r.note(3, { entryId: 7, source: 'reader' });
		await vi.advanceTimersByTimeAsync(FLUSH_IDLE_MS);
		expect(io.rows.has(3)).toBe(false);
		await vi.advanceTimersByTimeAsync(FLUSH_MAX_MS);
		expect(items(io, 3).map((i) => i.entryId)).toEqual([7]);
	});

	it('caps the buffer at 200, dropping the oldest', async () => {
		const io = fakeIO();
		const r = new LookupRecorder(io);
		expect(RECORDER_BUFFER_MAX).toBe(200);
		io.failWrites = 1;
		for (let i = 1; i <= 250; i++) r.note(3, { entryId: i, source: 'reader' });
		await r.flush();
		await r.flush();
		const ids = items(io, 3).map((i) => i.entryId);
		expect(ids).toHaveLength(200);
		expect(ids).not.toContain(50);
		expect(ids).toContain(51);
		expect(ids).toContain(250);
	});

	it('recording off: no write, buffer discarded, later lookups ignored until the switch reads on', async () => {
		const io = fakeIO();
		const r = new LookupRecorder(io);
		io.cfg = { version: 1, record: false };
		r.note(3, { entryId: 7, source: 'reader' });
		await r.flush();
		expect(io.log).toEqual(['cfg']);
		expect(r.recording).toBe(false);
		r.note(3, { entryId: 8, source: 'reader' });
		io.cfg = { version: 1, record: true };
		await r.flush();
		expect(io.log.filter((l) => l.startsWith('write'))).toEqual([]);
		await r.load(3);
		expect(r.recording).toBe(true);
		r.note(3, { entryId: 9, source: 'reader' });
		await r.flush();
		expect(items(io, 3).map((i) => i.entryId)).toEqual([9]);
	});

	it('a lookup made before a Clear elsewhere does not come back', async () => {
		const io = fakeIO();
		const r = new LookupRecorder(io);
		r.note(3, { entryId: 7, source: 'reader' });
		vi.setSystemTime(new Date('2026-11-16T09:01:00Z'));
		io.rows.set(3, { version: 1, clearedAt: '2026-11-16T09:00:30Z', items: [] });
		r.note(3, { entryId: 8, source: 'reader' });
		await r.flush();
		expect(items(io, 3).map((i) => i.entryId)).toEqual([8]);
	});

	it('countOf sums the last read copy and the buffer; reset drops both', async () => {
		const io = fakeIO();
		io.rows.set(3, { version: 1, clearedAt: null, items: [{ entryId: 7, count: 2, firstAt: '2026-11-01T09:00:00Z', lastAt: '2026-11-01T09:00:00Z', sources: { reader: 2 }, books: [] }] });
		const r = new LookupRecorder(io);
		await r.load(3);
		expect(r.countOf(3, 7)).toBe(2);
		expect(r.countOf(4, 7)).toBe(0);
		r.note(3, { entryId: 7, source: 'reader' });
		expect(r.countOf(3, 7)).toBe(3);
		r.reset();
		expect(r.countOf(3, 7)).toBe(0);
		await vi.advanceTimersByTimeAsync(FLUSH_MAX_MS * 2);
		expect(io.log.filter((l) => l.startsWith('write'))).toEqual([]);
	});

	it('countOf is 0 while recording is off', async () => {
		const io = fakeIO();
		io.rows.set(3, { version: 1, clearedAt: null, items: [{ entryId: 7, count: 5, firstAt: '2026-11-01T09:00:00Z', lastAt: '2026-11-01T09:00:00Z', sources: {}, books: [] }] });
		io.cfg = { version: 1, record: false };
		const r = new LookupRecorder(io);
		await r.load(3);
		expect(r.countOf(3, 7)).toBe(0);
	});

	it('adopt replaces the copy and drops buffered lookups of that workspace', async () => {
		const io = fakeIO();
		const r = new LookupRecorder(io);
		r.note(3, { entryId: 7, source: 'reader' });
		r.note(4, { entryId: 8, source: 'reader' });
		r.adopt(3, parseLookups({ version: 1, clearedAt: '2026-11-16T09:00:00Z', items: [] }));
		expect(r.countOf(3, 7)).toBe(0);
		await r.flush();
		expect(io.rows.has(3)).toBe(false);
		expect(items(io, 4).map((i) => i.entryId)).toEqual([8]);
	});

	it('never touches browser storage', async () => {
		const get = vi.spyOn(Storage.prototype, 'getItem');
		const set = vi.spyOn(Storage.prototype, 'setItem');
		const io = fakeIO();
		const r = new LookupRecorder(io);
		await r.load(3);
		r.note(3, { entryId: 7, source: 'reader' });
		await r.flush();
		r.countOf(3, 7);
		r.reset();
		expect(get).not.toHaveBeenCalled();
		expect(set).not.toHaveBeenCalled();
	});

	it('flushes when the page is hidden', async () => {
		const io = fakeIO();
		const r = new LookupRecorder(io);
		const detach = r.attach(document);
		r.note(3, { entryId: 7, source: 'reader' });
		const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(0);
		expect(io.log).toEqual(['cfg', 'read 3', 'write 3']);
		spy.mockReturnValue('visible');
		detach();
	});

	it('a flush with nothing buffered sends nothing', async () => {
		const io = fakeIO();
		const r = new LookupRecorder(io);
		await r.flush();
		expect(io.log).toEqual([]);
	});

	it('a lookup noted during a flush is kept for the next flush', async () => {
		const io = fakeIO();
		let release!: () => void;
		const gate = new Promise<void>((res) => (release = res));
		const read = io.readRow;
		io.readRow = async (ws) => {
			await gate;
			return read(ws);
		};
		const r = new LookupRecorder(io);
		r.note(3, { entryId: 7, source: 'reader' });
		const first = r.flush();
		await vi.advanceTimersByTimeAsync(0);
		r.note(3, { entryId: 8, source: 'reader' });
		release();
		await first;
		await r.flush();
		expect(items(io, 3).map((i) => i.entryId).sort()).toEqual([7, 8]);
	});

	it('exclusive waits for a flush in flight and blocks new ones, so a Clear is never undone (#72 review)', async () => {
		const io = fakeIO();
		const old = { version: 1, clearedAt: null, items: [{ entryId: 7, count: 2, firstAt: '2026-11-01T09:00:00Z', lastAt: '2026-11-01T09:00:00Z', sources: {}, books: [] }] };
		io.rows.set(3, old);
		let release!: () => void;
		const gate = new Promise<void>((res) => (release = res));
		const write = io.writeRow;
		io.writeRow = async (ws, data) => {
			await gate;
			return write(ws, data);
		};
		const r = new LookupRecorder(io);
		r.note(3, { entryId: 8, source: 'reader' });
		const flushing = r.flush();
		await vi.advanceTimersByTimeAsync(0);
		expect(io.log).toEqual(['cfg', 'read 3']); // the write is held
		const order: string[] = [];
		const clearing = r.exclusive(async () => {
			order.push('clear');
			io.rows.set(3, { version: 1, clearedAt: '2026-11-16T09:00:00.000Z', items: [] });
		});
		r.note(3, { entryId: 9, source: 'reader' });
		const later = r.flush();
		await vi.advanceTimersByTimeAsync(0);
		expect(order).toEqual([]);
		release();
		await flushing;
		await clearing;
		await later;
		expect(order).toEqual(['clear']);
		// the flush queued behind the clear read the cleared row; 9 was noted before the clear instant only if
		// the clock says so: here it is after (system time), so only 9 can be in the row, never 7 or 8
		const ids = items(io, 3).map((i) => i.entryId);
		expect(ids).not.toContain(7);
		expect(ids).not.toContain(8);
	});

	it('exclusive passes its result and error through and keeps the chain alive', async () => {
		const io = fakeIO();
		const r = new LookupRecorder(io);
		expect(await r.exclusive(async () => 5)).toBe(5);
		await expect(r.exclusive(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
		r.note(3, { entryId: 1, source: 'reader' });
		await r.flush();
		expect(items(io, 3).map((i) => i.entryId)).toEqual([1]);
	});
});
