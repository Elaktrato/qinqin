import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupResult } from '$lib/api/types';
import { NestedScan, SCAN_DEBOUNCE_MS, type ScanRequest } from './nestedScan';
import { PopupStack } from './popupStack.svelte';

interface Deferred {
	lang: string;
	text: string;
	offset: number;
	signal?: AbortSignal;
	resolve(results: LookupResult[]): void;
}

function result(term: string, start: number): LookupResult {
	return {
		entryId: 7,
		kind: 'word',
		term,
		reading: '',
		forms: [],
		readings: [],
		matched: term,
		start,
		end: start + Array.from(term).length,
		reasons: [],
		tags: [],
		frequencies: [],
		senses: [],
		pri: 0
	};
}

const anchor = { x: 1, y: 2, w: 3, h: 4 };

function setup() {
	const calls: Deferred[] = [];
	const lookup = vi.fn(
		(lang: string, text: string, offset: number, _kinds?: string[], signal?: AbortSignal) =>
			new Promise<LookupResult[]>((resolve) => calls.push({ lang, text, offset, signal, resolve }))
	);
	let shift = true;
	const stack = new PopupStack();
	const root = stack.open({ anchor, text: '為る', offset: 0, results: [result('為る', 0)] })!;
	const scan = new NestedScan({ lookup, isShift: () => shift, stack });
	const req = (offset: number, parentId = root, text = 'see also 為さる'): ScanRequest => ({
		parentId,
		lang: 'ja',
		text,
		offset,
		anchor: () => anchor
	});
	return {
		scan,
		stack,
		root,
		calls,
		lookup,
		req,
		setShift: (v: boolean) => (shift = v)
	};
}

describe('NestedScan', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('looks up the scanned text after the debounce and opens a child frame', async () => {
		const t = setup();
		t.scan.move(t.req(9));
		await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS - 1);
		expect(t.lookup).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(t.calls[0]).toMatchObject({ lang: 'ja', text: 'see also 為さる', offset: 9 });
		t.calls[0].resolve([result('為さる', 9)]);
		await vi.advanceTimersByTimeAsync(0);
		expect(t.stack.frames).toHaveLength(2);
		expect(t.stack.frames[1]).toMatchObject({ depth: 2, text: '為さる', offset: 9, anchor });
	});

	it('does nothing without Shift', async () => {
		const t = setup();
		t.setShift(false);
		t.scan.move(t.req(9));
		await vi.advanceTimersByTimeAsync(1000);
		expect(t.lookup).not.toHaveBeenCalled();
		expect(t.stack.frames).toHaveLength(1);
	});

	it('a move without Shift cancels a pending scan but releasing Shift closes nothing', async () => {
		const t = setup();
		t.scan.move(t.req(9));
		await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
		t.calls[0].resolve([result('為さる', 9)]);
		await vi.advanceTimersByTimeAsync(0);
		const frames = t.stack.frames;
		t.scan.move(t.req(0, t.root, '為る'));
		t.setShift(false);
		t.scan.move(t.req(0, t.root, '為る'));
		await vi.advanceTimersByTimeAsync(1000);
		expect(t.lookup).toHaveBeenCalledTimes(1);
		expect(t.stack.frames).toBe(frames);
	});

	it('opens nothing for an empty result list', async () => {
		const t = setup();
		t.scan.move(t.req(0, t.root, 'xyz'));
		await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
		const frames = t.stack.frames;
		t.calls[0].resolve([]);
		await vi.advanceTimersByTimeAsync(0);
		expect(t.stack.frames).toBe(frames);
	});

	it('a newer scan aborts the one in flight, whose late result is ignored', async () => {
		const t = setup();
		t.scan.move(t.req(9));
		await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
		t.scan.move(t.req(0, t.root, '為る'));
		await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
		expect(t.calls[0].signal?.aborted).toBe(true);
		t.calls[1].resolve([result('為る', 0)]);
		t.calls[0].resolve([result('為さる', 9)]);
		await vi.advanceTimersByTimeAsync(0);
		expect(t.stack.frames.map((f) => f.text)).toEqual(['為る', '為る']);
	});

	it('does not refetch while the pointer stays inside the opened child word', async () => {
		const t = setup();
		t.scan.move(t.req(9));
		await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
		t.calls[0].resolve([result('為さる', 9)]);
		await vi.advanceTimersByTimeAsync(0);
		t.scan.move(t.req(10));
		t.scan.move(t.req(11));
		await vi.advanceTimersByTimeAsync(1000);
		expect(t.lookup).toHaveBeenCalledTimes(1);
	});

	it('does not start a second request for the offset already in flight', async () => {
		const t = setup();
		t.scan.move(t.req(9));
		await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
		t.scan.move(t.req(9));
		await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
		expect(t.lookup).toHaveBeenCalledTimes(1);
	});

	it('a scan from a sibling region replaces the open child chain', async () => {
		const t = setup();
		t.scan.move(t.req(9));
		await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
		t.calls[0].resolve([result('為さる', 9)]);
		await vi.advanceTimersByTimeAsync(0);
		const child = t.stack.frames[1].id;
		t.scan.move(t.req(0, child, '為さる'));
		await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
		t.calls[1].resolve([result('為さる', 0)]);
		await vi.advanceTimersByTimeAsync(0);
		expect(t.stack.frames).toHaveLength(3);
		// Back in the root popup, another word: depth 2 again.
		t.scan.move(t.req(0, t.root, '為る'));
		await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
		t.calls[2].resolve([result('為る', 0)]);
		await vi.advanceTimersByTimeAsync(0);
		expect(t.stack.frames.map((f) => f.depth)).toEqual([1, 2]);
	});

	it('aborts a lookup whose parent closed, and its late result changes nothing', async () => {
		const t = setup();
		t.scan.move(t.req(9));
		await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
		t.stack.closeAll();
		t.scan.prune();
		expect(t.calls[0].signal?.aborted).toBe(true);
		const frames = t.stack.frames;
		t.calls[0].resolve([result('為さる', 9)]);
		await vi.advanceTimersByTimeAsync(0);
		expect(t.stack.frames).toBe(frames);
	});

	it('ignores a late result for a closed parent even without prune', async () => {
		const t = setup();
		t.scan.move(t.req(9));
		await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
		t.stack.closeAll();
		const reopened = t.stack.open({ anchor, text: '下', offset: 0, results: [result('下', 0)] });
		const frames = t.stack.frames;
		t.calls[0].resolve([result('為さる', 9)]);
		await vi.advanceTimersByTimeAsync(0);
		expect(t.stack.frames).toBe(frames);
		expect(t.stack.frames.map((f) => f.id)).toEqual([reopened]);
	});

	it('a pending scan for a closed parent never fires', async () => {
		const t = setup();
		t.scan.move(t.req(9));
		t.stack.closeAll();
		t.scan.prune();
		await vi.advanceTimersByTimeAsync(1000);
		expect(t.lookup).not.toHaveBeenCalled();
	});

	it('moving off any scan region aborts the lookup in flight', async () => {
		const t = setup();
		t.scan.move(t.req(9));
		await vi.advanceTimersByTimeAsync(SCAN_DEBOUNCE_MS);
		t.scan.move(null);
		expect(t.calls[0].signal?.aborted).toBe(true);
	});
});
