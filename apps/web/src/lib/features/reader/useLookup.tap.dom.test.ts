// Tap to look up (touch and pen): the LookupController turns a tap on a word
// into a sticky lookup for that word, and a drag, a long press, a scroll, a
// pointercancel, a tap on a control or one that left a selection into
// nothing. The text is real DOM; only the layout (caret and boxes, which
// jsdom does not compute) and the server lookup are faked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LookupResult } from '$lib/api/types';

const layout = vi.hoisted(() => ({
	caret: null as { node: Node; offset: number } | null,
	rect: { top: 600, height: 30 },
	/** Whether a character box holds a point at this height (the line's glyphs). */
	hit: (_y: number): boolean => true
}));
vi.mock('./dom', async (orig) => ({
	...(await orig<typeof import('./dom')>()),
	caretFromPoint: () => layout.caret,
	rangeContainsPoint: (_r: Range, _x: number, y: number) => layout.hit(y),
	rangeForSpan: () =>
		({ getBoundingClientRect: () => new DOMRect(40, layout.rect.top, 20, layout.rect.height) }) as unknown as Range
}));
const server = vi.hoisted(() => ({ calls: 0 }));
vi.mock('$lib/api/lookup', async (orig) => ({
	...(await orig<typeof import('$lib/api/lookup')>()),
	// 水 is a word of its own; everything else has no entry.
	lookupAt: async (_lang: string, text: string): Promise<LookupResult[]> => {
		server.calls++;
		return text.startsWith('水')
			? [{ entryId: 7, term: '水', matched: '水', start: 0, end: 1 } as unknown as LookupResult]
			: [];
	}
}));

import { LookupController } from './useLookup.svelte';
import { FLING_STOP_MS, TAP_MAX_MOVE_PX, TAP_MAX_MS } from './tapGesture';

const TEXT = '私は水を飲みます。';
let clock = 0;
let container: HTMLElement;
let run: HTMLElement;
let onLookup: ReturnType<typeof vi.fn<(entryId: number, mode: 'hover' | 'selection') => void>>;
let onTapNoWord: ReturnType<typeof vi.fn<(target: Element) => void>>;
let ctl: LookupController;
let cleanup: (() => void)[];

/** The caret lands before code point `i` of the paragraph. */
function caretAt(i: number): void {
	layout.caret = { node: run.firstChild!, offset: i };
}

function pointer(type: string, target: EventTarget, over: PointerEventInit = {}): void {
	target.dispatchEvent(
		new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 50, clientY: 610, ...over })
	);
}

/** Down, then up `ms` later at the same point (unless over says otherwise). */
async function tap(target: EventTarget = run, ms = 80, over: PointerEventInit = {}): Promise<void> {
	pointer('pointerdown', target, over);
	clock += ms;
	pointer('pointerup', target, over);
	await vi.advanceTimersByTimeAsync(100);
}

beforeEach(() => {
	vi.useFakeTimers();
	clock = 1000;
	server.calls = 0;
	document.body.innerHTML = `<div id="text"><p data-p="0"><span data-r="0">${TEXT}</span></p><p data-p="1"><button type="button" data-r="0">水</button></p></div>`;
	container = document.getElementById('text')!;
	run = container.querySelector('[data-p="0"] [data-r]')!;
	caretAt(2);
	layout.hit = () => true;
	onTapNoWord = vi.fn<(target: Element) => void>();
	onLookup = vi.fn<(entryId: number, mode: 'hover' | 'selection') => void>();
	ctl = new LookupController({
		container: () => container,
		lang: () => 'ja',
		textLang: () => 'ja',
		runsOf: (p) => (p === 0 ? [{ text: TEXT }] : p === 1 ? [{ text: '水' }] : undefined),
		onLookup,
		onTapNoWord,
		now: () => clock
	});
	cleanup = [ctl.attach(), ctl.listen(container)];
});
afterEach(() => {
	for (const undo of cleanup) undo();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
	vi.useRealTimers();
});

describe('a tap on a word', () => {
	it('opens a sticky lookup for that word, counted in the history like a selection', async () => {
		await tap();
		expect(ctl.info?.mode).toBe('selection');
		expect(ctl.tapped).toBe(true);
		expect(ctl.stack.frames).toHaveLength(1);
		expect(ctl.stack.frames[0]).toMatchObject({ text: '水', results: [{ entryId: 7 }] });
		expect(ctl.selectedSpan).toEqual({ p: 0, start: 2, end: 3, clamped: false });
		expect(ctl.info?.paragraph).toBe(TEXT);
		expect(onLookup).toHaveBeenCalledExactlyOnceWith(7, 'selection');
		// Sticky: no grace hide.
		await vi.advanceTimersByTimeAsync(5000);
		expect(ctl.info).not.toBeNull();
	});

	it('a pen taps too', async () => {
		await tap(run, 80, { pointerType: 'pen' });
		expect(ctl.stack.frames[0]?.text).toBe('水');
	});

	it('a lookable character without an entry opens the not-found lookup', async () => {
		caretAt(5);
		await tap();
		expect(ctl.stack.frames[0]).toMatchObject({ text: 'み', results: [] });
		expect(onLookup).not.toHaveBeenCalled();
	});

	it('a tap on no word (punctuation) closes the open lookup and opens none', async () => {
		await tap();
		expect(ctl.info).not.toBeNull();
		caretAt(8);
		await tap();
		expect(ctl.info).toBeNull();
		expect(ctl.stack.frames).toEqual([]);
	});

	it('a tap on no word inside the text tells the host what it landed on; a word or the outside does not', async () => {
		caretAt(8);
		await tap();
		expect(onTapNoWord).toHaveBeenCalledExactlyOnceWith(run);
		onTapNoWord.mockClear();
		caretAt(2);
		await tap();
		const outside = document.createElement('p');
		document.body.append(outside);
		await tap(outside);
		expect(onTapNoWord).not.toHaveBeenCalled();
	});

	it('a finger in the gap between lines finds the nearer line’s character, within the slack', async () => {
		const paragraph = container.querySelector<HTMLElement>('[data-p="0"]')!;
		// The glyphs start 8 px under the finger (y 610): the last probe reaches them.
		layout.hit = (y) => y >= 618;
		await tap(paragraph);
		expect(ctl.stack.frames[0]?.text).toBe('水');
		ctl.close();
		layout.hit = (y) => y >= 619;
		await tap(paragraph);
		expect(ctl.info).toBeNull();
	});

	it('hover stays exact: no slack and only over the text', async () => {
		layout.hit = (y) => y >= 614;
		pointer('pointermove', run, { pointerType: 'mouse' });
		await vi.advanceTimersByTimeAsync(500);
		expect(ctl.info).toBeNull();
		expect(server.calls).toBe(0);
	});

	it('a tap on another word replaces the lookup', async () => {
		caretAt(5);
		await tap();
		caretAt(2);
		await tap();
		expect(ctl.stack.frames).toHaveLength(1);
		expect(ctl.stack.frames[0].text).toBe('水');
	});

	it('sets touch-action: manipulation on the text (no double-tap delay) and gives it back', () => {
		expect(container.style.touchAction).toBe('manipulation');
		cleanup.pop()!();
		expect(container.style.touchAction).toBe('');
	});
});

describe('what is no tap', () => {
	it('a drag', async () => {
		pointer('pointerdown', run);
		pointer('pointermove', run, { clientX: 50 + TAP_MAX_MOVE_PX + 5 });
		clock += 80;
		pointer('pointerup', run, { clientX: 50 + TAP_MAX_MOVE_PX + 5 });
		await vi.advanceTimersByTimeAsync(100);
		expect(ctl.info).toBeNull();
		expect(server.calls).toBe(0);
	});

	it('a long press', async () => {
		await tap(run, TAP_MAX_MS + 100);
		expect(ctl.info).toBeNull();
		expect(server.calls).toBe(0);
	});

	it('a press that stops a scroll fling', async () => {
		for (let i = 0; i < 10; i++) {
			window.dispatchEvent(new Event('scroll'));
			clock += 16;
		}
		await tap(run, 60);
		expect(ctl.info).toBeNull();
		// Once the page has settled, a tap is a tap again.
		clock += FLING_STOP_MS;
		await tap();
		expect(ctl.info).not.toBeNull();
	});

	it('a scroll in between', async () => {
		pointer('pointerdown', run);
		window.dispatchEvent(new Event('scroll'));
		clock += 80;
		pointer('pointerup', run);
		await vi.advanceTimersByTimeAsync(100);
		expect(ctl.info).toBeNull();
	});

	it('a pointercancel (the browser panned)', async () => {
		pointer('pointerdown', run);
		pointer('pointercancel', run);
		clock += 80;
		pointer('pointerup', run);
		await vi.advanceTimersByTimeAsync(100);
		expect(ctl.info).toBeNull();
	});

	it('a mouse click (the mouse hovers instead)', async () => {
		await tap(run, 80, { pointerType: 'mouse' });
		expect(ctl.info).toBeNull();
		expect(server.calls).toBe(0);
	});

	it('a tap on a control inside the text', async () => {
		const button = container.querySelector('button')!;
		layout.caret = { node: button.firstChild!, offset: 0 };
		await tap(button);
		expect(ctl.info).toBeNull();
	});

	it('a tap outside the text', async () => {
		const outside = document.createElement('p');
		outside.textContent = '水';
		document.body.append(outside);
		await tap(outside);
		expect(ctl.info).toBeNull();
	});

	it('a press that left a selection (the selection lookup takes it)', async () => {
		vi.spyOn(window, 'getSelection').mockReturnValue({ rangeCount: 1, isCollapsed: false, getRangeAt: () => document.createRange() } as unknown as Selection);
		await tap();
		expect(ctl.tapped).toBe(false);
		expect(server.calls).toBe(0);
	});
});

describe('fromTouch', () => {
	it('a click right after a touch tap is the tap’s; a mouse click never is', async () => {
		await tap();
		expect(ctl.fromTouch(new MouseEvent('click', { detail: 1 }))).toBe(true);
		expect(ctl.fromTouch(new PointerEvent('click', { detail: 1, pointerType: 'mouse' }))).toBe(false);
		expect(ctl.fromTouch(new PointerEvent('click', { detail: 1, pointerType: 'touch' }))).toBe(true);
		// The keyboard (Enter on a focused link) right after a touch.
		expect(ctl.fromTouch(new MouseEvent('click', { detail: 0 }))).toBe(false);
		clock += 5000;
		expect(ctl.fromTouch(new MouseEvent('click', { detail: 1 }))).toBe(false);
	});
});

describe('keepWordAbove', () => {
	it('scrolls the window so the tapped word ends above the sheet’s top', async () => {
		const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
		await tap();
		ctl.keepWordAbove(400);
		// The word's box: 600 to 630; 12 px above 400.
		expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 630 + 12 - 400, behavior: 'smooth' });
	});

	it('a word that is visible already does not move', async () => {
		const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
		layout.rect = { top: 100, height: 30 };
		await tap();
		ctl.keepWordAbove(400);
		expect(scrollBy).not.toHaveBeenCalled();
		layout.rect = { top: 600, height: 30 };
	});

	it('does nothing without a sticky lookup', () => {
		const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
		ctl.keepWordAbove(400);
		expect(scrollBy).not.toHaveBeenCalled();
	});
});
