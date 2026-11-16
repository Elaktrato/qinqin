import { describe, expect, it } from 'vitest';
import mergeFixture from '../../../../../docs/contracts/lookups/lookup-merge.json';
import promptFixture from '../../../../../docs/contracts/lookups/lookup-prompt.json';
import rowsFixture from '../../../../../docs/contracts/lookups/lookup-rows.json';
import {
	LOOKUPS_KEY,
	LOOKUP_CAP,
	LOOKUP_CFG_KEY,
	LOOKUP_DEDUPE_MS,
	PROMPT_MAX,
	PROMPT_MIN_COUNT,
	clearedLookups,
	mergeLookups,
	parseLookupCfg,
	parseLookups,
	promptItems,
	removeLookups,
	serializeLookupCfg,
	serializeLookups,
	staleAfterClear,
	type LookupHit
} from './lookups';

interface Generate {
	items: number;
	entryIdFrom: number;
	lastAtFrom: string;
	stepMs: number;
	count: number;
	sources?: Record<string, number>;
	books?: number[];
	same?: { entryIds: number[]; lastAt: string; counts: number[] };
}

function generated(g: Generate): unknown {
	const from = Date.parse(g.lastAtFrom);
	const items = [];
	for (let i = 0; i < g.items; i++) {
		const entryId = g.entryIdFrom + i;
		let at = new Date(from + i * g.stepMs).toISOString();
		let count = g.count;
		const same = g.same?.entryIds.indexOf(entryId) ?? -1;
		if (g.same && same >= 0) {
			at = g.same.lastAt;
			count = g.same.counts[same];
		}
		items.push({ entryId, count, firstAt: at, lastAt: at, sources: g.sources ?? { reader: count }, books: g.books ?? [] });
	}
	return { version: 1, clearedAt: null, items };
}

describe('constants', () => {
	it('match the contract', () => {
		expect(LOOKUPS_KEY).toBe('lookups');
		expect(LOOKUP_CFG_KEY).toBe('lookupcfg');
		expect(LOOKUP_CAP).toBe(500);
		expect(LOOKUP_DEDUPE_MS).toBe(600_000);
		expect(PROMPT_MIN_COUNT).toBe(3);
		expect(PROMPT_MAX).toBe(10);
	});
});

describe('docs/contracts/lookups/lookup-rows.json', () => {
	it('is the lookups/rows fixture', () => {
		expect(rowsFixture.version).toBe(1);
		expect(rowsFixture.rule).toBe('lookups/rows');
		expect(rowsFixture.cases.length).toBeGreaterThan(30);
	});

	it.each(rowsFixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
		if (c.op === 'rows') {
			expect(parseLookups(c.input.data, c.input.deletedAt)).toEqual(c.expect);
		} else {
			expect(parseLookupCfg(c.input.deletedAt === null ? c.input.data : null)).toEqual(c.expect);
		}
	});
});

describe('docs/contracts/lookups/lookup-merge.json', () => {
	it('is the lookups/merge fixture', () => {
		expect(mergeFixture.rule).toBe('lookups/merge');
		expect(mergeFixture.cases.length).toBeGreaterThan(15);
	});

	it.each(mergeFixture.cases.map((c) => [c.name, c] as const))('%s', (_name, raw) => {
		const c = raw as { op: string; input: Record<string, unknown>; expect: unknown };
		const row = c.input.generate ? generated(c.input.generate as Generate) : c.input.row;
		const h = parseLookups(row ?? null);
		switch (c.op) {
			case 'merge':
				expect(serializeLookups(mergeLookups(h, c.input.hits as LookupHit[]))).toEqual(c.expect);
				break;
			case 'evict': {
				const out = mergeLookups(h, c.input.hits as LookupHit[]);
				const want = c.expect as { length: number; absent: number[]; present: number[]; first: number };
				const ids = out.items.map((i) => i.entryId);
				expect(ids.length).toBe(want.length);
				for (const id of want.absent) expect(ids).not.toContain(id);
				for (const id of want.present) expect(ids).toContain(id);
				expect(ids[0]).toBe(want.first);
				break;
			}
			case 'remove':
				expect(serializeLookups(removeLookups(h, c.input.entryIds as number[]))).toEqual(c.expect);
				break;
			case 'clear':
				expect(serializeLookups(clearedLookups(h, new Date(c.input.now as string)))).toEqual(c.expect);
				break;
			case 'staleAfterClear':
				expect(staleAfterClear(h)).toBe(c.expect);
				break;
			case 'size': {
				expect(h.items.length).toBe(LOOKUP_CAP);
				const bytes = new TextEncoder().encode(JSON.stringify(serializeLookups(h))).length;
				expect(bytes).toBeLessThanOrEqual((c.expect as { maxBytes: number }).maxBytes);
				break;
			}
			default:
				throw new Error(`unknown op ${c.op}`);
		}
	});
});

describe('docs/contracts/lookups/lookup-prompt.json', () => {
	it('is the lookups/prompt fixture', () => {
		expect(promptFixture.rule).toBe('lookups/prompt');
	});

	it.each(promptFixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
		const states = c.input.states as Record<string, 'new' | 'learning' | 'known'>;
		const got = promptItems(parseLookups(c.input.row), (id) => states[String(id)] ?? 'new');
		expect(got.map((i) => i.entryId)).toEqual(c.expect);
	});
});

describe('serialise', () => {
	it('round-trips through parse', () => {
		const h = mergeLookups(parseLookups(null), [{ entryId: 3, at: '2026-11-16T09:00:00.000Z', source: 'reader', bookId: 2 }]);
		expect(parseLookups(serializeLookups(h))).toEqual(h);
	});

	it('does not share arrays with its input', () => {
		const h = mergeLookups(parseLookups(null), [{ entryId: 3, at: '2026-11-16T09:00:00.000Z', source: 'reader', bookId: 2 }]);
		const again = mergeLookups(h, [{ entryId: 3, at: '2026-11-16T10:00:00.000Z', source: 'reader', bookId: 9 }]);
		expect(h.items[0].books).toEqual([2]);
		expect(h.items[0].count).toBe(1);
		expect(again.items[0].books).toEqual([9, 2]);
	});

	it('keeps cfg extras on save', () => {
		expect(serializeLookupCfg(false, { extra: { a: 1 } })).toEqual({ a: 1, version: 1, record: false });
		expect(serializeLookupCfg(true)).toEqual({ version: 1, record: true });
	});
});
