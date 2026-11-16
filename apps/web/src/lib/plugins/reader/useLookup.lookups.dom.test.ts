// The lookup history hooks of the reader's LookupController (#72): which
// popups count as a lookup. The DOM mapping and the lookup itself are
// mocked; HoverLookup is captured so a test can show a hover popup.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupResult } from '$lib/api/types';
import type { HoverDeps, HoverShown } from './hoverLookup';

const hover = vi.hoisted(() => ({ deps: null as HoverDeps | null }));
vi.mock('./hoverLookup', async (orig) => {
	const real = await orig<typeof import('./hoverLookup')>();
	return {
		...real,
		HoverLookup: class extends real.HoverLookup {
			constructor(deps: HoverDeps) {
				super(deps);
				hover.deps = deps;
			}
		}
	};
});
const sel = vi.hoisted(() => ({ results: [] as LookupResult[] }));
vi.mock('./selectionLookup', async (orig) => ({
	...(await orig<typeof import('./selectionLookup')>()),
	selectionSpanTarget: () => ({ start: 0, end: 1, text: '马' }),
	lookupSelection: async () => ({ results: sel.results, note: '' })
}));
vi.mock('./dom', async (orig) => ({
	...(await orig<typeof import('./dom')>()),
	rangeForSpan: () => ({ getBoundingClientRect: () => new DOMRect(0, 0, 10, 10) }) as unknown as Range,
	selectionSpan: () => ({ p: 0, start: 0, end: 1 }),
	highlightSpan: () => ({ p: 0, start: 0, end: 1 })
}));

import { LookupController } from './useLookup.svelte';

const result = (entryId: number) => ({ entryId, term: 'x', matched: 'x', start: 0, end: 1 }) as unknown as LookupResult;
const shown = (ids: number[]): HoverShown => ({ span: { p: 0, start: 0, end: 1 }, text: '马', offset: 0, results: ids.map(result), error: '' });

const mouse = { pointerType: 'mouse' } as PointerEvent;
let onLookup: ReturnType<typeof vi.fn>;
let ctl: LookupController;
let detach: () => void;

beforeEach(() => {
	vi.useFakeTimers();
	onLookup = vi.fn();
	const container = document.createElement('div');
	document.body.append(container);
	ctl = new LookupController({
		container: () => container,
		lang: () => 'zh',
		textLang: () => 'zh-Hans',
		runsOf: () => [{ text: '马上' }],
		onLookup
	});
	detach = ctl.attach();
});
afterEach(() => {
	detach();
	document.body.innerHTML = '';
	vi.useRealTimers();
});

describe('LookupController lookup history hooks', () => {
	it('passing over three words records nothing', () => {
		for (const id of [1, 2, 3]) {
			hover.deps!.show(shown([id]));
			vi.advanceTimersByTime(300);
		}
		ctl.close();
		vi.advanceTimersByTime(5000);
		expect(onLookup).not.toHaveBeenCalled();
	});

	it('a hover popup resting one second records its first result once', () => {
		hover.deps!.show(shown([11, 12]));
		vi.advanceTimersByTime(1000);
		expect(onLookup).toHaveBeenCalledExactlyOnceWith(11, 'hover');
		vi.advanceTimersByTime(5000);
		expect(onLookup).toHaveBeenCalledTimes(1);
	});

	it('entering the popup records at once, not again at one second', () => {
		hover.deps!.show(shown([11]));
		vi.advanceTimersByTime(100);
		ctl.popups.enter(mouse);
		expect(onLookup).toHaveBeenCalledExactlyOnceWith(11, 'hover');
		vi.advanceTimersByTime(2000);
		expect(onLookup).toHaveBeenCalledTimes(1);
	});

	it('a selection with results records at once; without results nothing', async () => {
		vi.spyOn(window, 'getSelection').mockReturnValue({
			rangeCount: 1,
			isCollapsed: false,
			getRangeAt: () => document.createRange()
		} as unknown as Selection);
		sel.results = [result(21), result(22)];
		document.dispatchEvent(new Event('selectionchange'));
		await vi.advanceTimersByTimeAsync(300);
		expect(onLookup).toHaveBeenCalledExactlyOnceWith(21, 'selection');
		ctl.close();
		onLookup.mockClear();
		sel.results = [];
		document.dispatchEvent(new Event('selectionchange'));
		await vi.advanceTimersByTimeAsync(300);
		expect(onLookup).not.toHaveBeenCalled();
	});

	it('a nested popup records nothing', () => {
		hover.deps!.show(shown([11]));
		ctl.popups.enter(mouse);
		onLookup.mockClear();
		const root = ctl.stack.frames[0];
		ctl.stack.open({ anchor: root.anchor, text: '上', offset: 0, results: [result(31)] }, root.id);
		vi.advanceTimersByTime(2000);
		ctl.popups.enter(mouse);
		expect(onLookup).not.toHaveBeenCalled();
	});

	it('without onLookup nothing breaks', () => {
		const plain = new LookupController({ container: () => null, lang: () => 'zh', textLang: () => 'zh', runsOf: () => undefined });
		expect(plain.stack.frames).toEqual([]);
	});
});
