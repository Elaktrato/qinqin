import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupResult } from '$lib/api/types';
import { HOVER_GRACE_MS, HoverLookup, type HoverShown } from './hoverLookup';

interface Deferred {
	text: string;
	offset: number;
	signal?: AbortSignal;
	resolve(results: LookupResult[]): void;
	reject(err: unknown): void;
}

function result(term: string, start: number): LookupResult {
	return {
		entryId: 1,
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

function setup() {
	const calls: Deferred[] = [];
	const lookup = vi.fn(
		(_lang: string, text: string, offset: number, _kinds?: string[], signal?: AbortSignal) =>
			new Promise<LookupResult[]>((resolve, reject) => {
				calls.push({ text, offset, signal, resolve, reject });
			})
	);
	const shown: HoverShown[] = [];
	let visible: HoverShown | null = null;
	const show = vi.fn((s: HoverShown) => {
		shown.push(s);
		visible = s;
	});
	const hide = vi.fn(() => {
		visible = null;
	});
	const hover = new HoverLookup({ lookup, show, hide, lang: () => 'zh' });
	return { hover, calls, lookup, shown, show, hide, visible: () => visible };
}

const text = '我学习中文。';

describe('HoverLookup', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('shows the result list found at the hovered offset, spanning the first result', async () => {
		const t = setup();
		t.hover.point(0, text, 1);
		expect(t.lookup).toHaveBeenCalledWith('zh', text, 1, undefined, t.calls[0].signal);
		t.calls[0].resolve([result('学习', 1), result('学', 1)]);
		await vi.advanceTimersByTimeAsync(0);
		expect(t.visible()).toMatchObject({
			span: { p: 0, start: 1, end: 3 },
			text: '学习',
			offset: 1,
			results: [{ term: '学习' }, { term: '学' }]
		});
	});

	it('does not refetch while the pointer stays inside the shown word', async () => {
		const t = setup();
		t.hover.point(0, text, 1);
		t.calls[0].resolve([result('学习', 1)]);
		await vi.advanceTimersByTimeAsync(0);
		t.hover.point(0, text, 2);
		await vi.advanceTimersByTimeAsync(1000);
		expect(t.lookup).toHaveBeenCalledTimes(1);
		expect(t.hide).not.toHaveBeenCalled();
	});

	it('shows the next word even when its lookup outlasts the grace delay', async () => {
		const t = setup();
		t.hover.point(0, text, 1);
		t.calls[0].resolve([result('学习', 1)]);
		await vi.advanceTimersByTimeAsync(0);
		// Pointer moves on to 中文; its lookup is slow (400 ms).
		t.hover.point(0, text, 3);
		await vi.advanceTimersByTimeAsync(HOVER_GRACE_MS);
		// The old popup is hidden after the grace delay...
		expect(t.visible()).toBeNull();
		expect(t.calls[1].signal?.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(400 - HOVER_GRACE_MS);
		t.calls[1].resolve([result('中文', 3)]);
		await vi.advanceTimersByTimeAsync(0);
		// ...but the new one still arrives.
		expect(t.visible()).toMatchObject({ results: [{ term: '中文' }] });
	});

	it('discards a lookup in flight when the pointer moves to no word', async () => {
		const t = setup();
		t.hover.point(0, text, 1);
		t.hover.noWord();
		expect(t.calls[0].signal?.aborted).toBe(true);
		t.calls[0].resolve([result('学习', 1)]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(t.show).not.toHaveBeenCalled();
	});

	it('hides a shown popup after the grace delay when the pointer leaves the word', async () => {
		const t = setup();
		t.hover.point(0, text, 1);
		t.calls[0].resolve([result('学习', 1)]);
		await vi.advanceTimersByTimeAsync(0);
		t.hover.noWord();
		await vi.advanceTimersByTimeAsync(HOVER_GRACE_MS - 1);
		expect(t.visible()).not.toBeNull();
		// Coming back within the grace keeps it.
		t.hover.point(0, text, 2);
		await vi.advanceTimersByTimeAsync(1000);
		expect(t.visible()).not.toBeNull();
		t.hover.noWord();
		await vi.advanceTimersByTimeAsync(HOVER_GRACE_MS);
		expect(t.visible()).toBeNull();
	});

	it('keeps the popup while the pointer is inside it and hides it after leaving it', async () => {
		const t = setup();
		t.hover.point(0, text, 1);
		t.calls[0].resolve([result('学习', 1)]);
		await vi.advanceTimersByTimeAsync(0);
		// Word -> popup: leaving the word arms the grace, entering a popup cancels it.
		t.hover.noWord();
		await vi.advanceTimersByTimeAsync(HOVER_GRACE_MS - 1);
		t.hover.enterPopup();
		await vi.advanceTimersByTimeAsync(5000);
		expect(t.visible()).not.toBeNull();
		t.hover.leavePopup();
		await vi.advanceTimersByTimeAsync(HOVER_GRACE_MS - 1);
		expect(t.visible()).not.toBeNull();
		await vi.advanceTimersByTimeAsync(1);
		expect(t.visible()).toBeNull();
	});

	it('moving between popups (leave then enter) keeps them', async () => {
		const t = setup();
		t.hover.point(0, text, 1);
		t.calls[0].resolve([result('学习', 1)]);
		await vi.advanceTimersByTimeAsync(0);
		t.hover.enterPopup();
		t.hover.leavePopup();
		t.hover.enterPopup();
		await vi.advanceTimersByTimeAsync(5000);
		expect(t.hide).not.toHaveBeenCalled();
	});

	it('returning to the shown word cancels a newer lookup in flight', async () => {
		const t = setup();
		t.hover.point(0, text, 1);
		t.calls[0].resolve([result('学习', 1)]);
		await vi.advanceTimersByTimeAsync(0);
		t.hover.point(0, text, 3);
		t.hover.point(0, text, 1);
		expect(t.calls[1].signal?.aborted).toBe(true);
		t.calls[1].resolve([result('中文', 3)]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(t.visible()).toMatchObject({ results: [{ term: '学习' }] });
	});

	it('does not start a second request for the offset already in flight', () => {
		const t = setup();
		t.hover.point(0, text, 3);
		t.hover.point(0, text, 3);
		expect(t.lookup).toHaveBeenCalledTimes(1);
	});

	it('a newer lookup supersedes an older one that resolves late', async () => {
		const t = setup();
		t.hover.point(0, text, 1);
		t.hover.point(0, text, 3);
		expect(t.calls[0].signal?.aborted).toBe(true);
		t.calls[1].resolve([result('中文', 3)]);
		t.calls[0].resolve([result('学习', 1)]);
		await vi.advanceTimersByTimeAsync(0);
		expect(t.shown.map((s) => s.results[0]?.term)).toEqual(['中文']);
	});

	it('shows no popup when the lookup finds nothing', async () => {
		const t = setup();
		t.hover.point(0, text, 0);
		t.calls[0].resolve([]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(t.show).not.toHaveBeenCalled();
		expect(t.visible()).toBeNull();
	});

	it('hides the shown word after the grace delay when the next lookup finds nothing', async () => {
		const t = setup();
		t.hover.point(0, text, 1);
		t.calls[0].resolve([result('学习', 1)]);
		await vi.advanceTimersByTimeAsync(0);
		t.hover.point(0, text, 5);
		t.calls[1].resolve([]);
		await vi.advanceTimersByTimeAsync(HOVER_GRACE_MS);
		expect(t.show).toHaveBeenCalledTimes(1);
		expect(t.visible()).toBeNull();
	});

	it('does not refetch an offset that just found nothing', async () => {
		const t = setup();
		t.hover.point(0, text, 0);
		t.calls[0].resolve([]);
		await vi.advanceTimersByTimeAsync(0);
		t.hover.point(0, text, 0);
		expect(t.lookup).toHaveBeenCalledTimes(1);
	});

	it('shows an error but stays silent for aborts', async () => {
		const t = setup();
		t.hover.point(0, text, 1);
		t.calls[0].reject(new TypeError('Failed to fetch'));
		await vi.advanceTimersByTimeAsync(0);
		expect(t.visible()).toMatchObject({ results: [], error: 'Could not look this up.' });
	});

	it('close aborts, cancels the grace and hides at once', async () => {
		const t = setup();
		t.hover.point(0, text, 1);
		t.calls[0].resolve([result('学习', 1)]);
		await vi.advanceTimersByTimeAsync(0);
		t.hover.point(0, text, 3);
		t.hover.close();
		expect(t.visible()).toBeNull();
		expect(t.calls[1].signal?.aborted).toBe(true);
		t.calls[1].resolve([result('中文', 3)]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(t.show).toHaveBeenCalledTimes(1);
	});

	it('close also forgets being inside a popup', async () => {
		const t = setup();
		t.hover.point(0, text, 1);
		t.calls[0].resolve([result('学习', 1)]);
		await vi.advanceTimersByTimeAsync(0);
		t.hover.enterPopup();
		t.hover.close();
		t.hover.point(0, text, 3);
		t.calls[1].resolve([result('中文', 3)]);
		await vi.advanceTimersByTimeAsync(0);
		t.hover.noWord();
		await vi.advanceTimersByTimeAsync(HOVER_GRACE_MS);
		expect(t.visible()).toBeNull();
	});
});
