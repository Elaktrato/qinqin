import { describe, expect, it, vi } from 'vitest';
import type { EntryBase } from '$lib/api/types';
import { loadEntryExtras } from './extras';

const char = (id: number, written: string): EntryBase =>
	({ id, language: 'zh', kind: 'character', written, readings: [], radicalId: null }) as unknown as EntryBase;

function deps(over: Partial<Parameters<typeof loadEntryExtras>[1]> = {}) {
	return {
		chars: vi.fn(async () => [char(6, '他')]),
		entry: vi.fn(async () => ({ written: '亻' })),
		...over
	};
}

describe('loadEntryExtras', () => {
	it('never asks for characters under a word', async () => {
		const d = deps();
		const out = await loadEntryExtras({ id: 5, kind: 'word', radicalId: null }, d);
		expect(d.chars).not.toHaveBeenCalled();
		expect(out).toEqual({ chars: [], radicalWritten: '' });
	});

	it('lists the characters under a character entry', async () => {
		const d = deps();
		const out = await loadEntryExtras({ id: 5, kind: 'character', radicalId: null }, d);
		expect(d.chars).toHaveBeenCalledWith(5);
		expect(out.chars.map((c) => c.written)).toEqual(['他']);
		expect(d.entry).not.toHaveBeenCalled();
	});

	it('falls back to no characters when /chars fails, keeping the radical', async () => {
		const d = deps({ chars: vi.fn(async () => Promise.reject(new Error('down'))) });
		const out = await loadEntryExtras({ id: 5, kind: 'character', radicalId: 9 }, d);
		expect(out).toEqual({ chars: [], radicalWritten: '亻' });
		expect(d.entry).toHaveBeenCalledWith(9);
	});

	it('falls back to no radical form when its fetch fails, keeping the characters', async () => {
		const d = deps({ entry: vi.fn(async () => Promise.reject(new Error('down'))) });
		const out = await loadEntryExtras({ id: 5, kind: 'character', radicalId: 9 }, d);
		expect(out.radicalWritten).toBe('');
		expect(out.chars).toHaveLength(1);
	});

	it('settles even when both requests fail', async () => {
		const fail = async () => Promise.reject(new Error('down'));
		const out = await loadEntryExtras(
			{ id: 5, kind: 'character', radicalId: 9 },
			deps({ chars: vi.fn(fail), entry: vi.fn(fail) })
		);
		expect(out).toEqual({ chars: [], radicalWritten: '' });
	});

	it('a word with a radical still gets the radical form', async () => {
		const d = deps();
		const out = await loadEntryExtras({ id: 5, kind: 'word', radicalId: 9 }, d);
		expect(out).toEqual({ chars: [], radicalWritten: '亻' });
	});

	it('a radical that is its own radical uses its own written form without a second request', async () => {
		const d = deps();
		const out = await loadEntryExtras({ id: 9, kind: 'character', radicalId: 9, written: '人' }, d);
		expect(out.radicalWritten).toBe('人');
		expect(d.entry).not.toHaveBeenCalled();
		expect(d.chars).toHaveBeenCalledWith(9);
	});
});
