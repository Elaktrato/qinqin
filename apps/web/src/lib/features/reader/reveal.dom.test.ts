import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReveal, REVEAL_MS, revealKey, TAP_SLOP_PX, tapTarget } from './reveal';

function ruby(concealed: boolean): HTMLElement {
	const el = document.createElement('ruby');
	el.innerHTML = `你好<rt class="${concealed ? 'concealed' : ''}">nǐ hǎo</rt>`;
	document.body.append(el);
	return el;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('createReveal', () => {
	it('a tap reveals for 4 seconds, then hides', () => {
		const el = ruby(true);
		const reveal = createReveal();
		reveal.tap(el);
		expect(el.classList.contains('revealed')).toBe(true);
		vi.advanceTimersByTime(REVEAL_MS - 1);
		expect(el.classList.contains('revealed')).toBe(true);
		vi.advanceTimersByTime(1);
		expect(el.classList.contains('revealed')).toBe(false);
	});

	it('a second tap restarts the timer', () => {
		const el = ruby(true);
		const reveal = createReveal();
		reveal.tap(el);
		vi.advanceTimersByTime(3000);
		reveal.tap(el);
		vi.advanceTimersByTime(3000);
		expect(el.classList.contains('revealed')).toBe(true);
		vi.advanceTimersByTime(1000);
		expect(el.classList.contains('revealed')).toBe(false);
	});

	it('reset hides everything and cancels the timers', () => {
		const a = ruby(true);
		const b = ruby(true);
		const reveal = createReveal();
		reveal.tap(a);
		reveal.tap(b);
		reveal.reset();
		expect(document.querySelectorAll('.revealed')).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('toggleAll flips the state and reports it', () => {
		const seen: boolean[] = [];
		const reveal = createReveal({ onAll: (v) => seen.push(v) });
		expect(reveal.isAllShown).toBe(false);
		reveal.toggleAll();
		expect(reveal.isAllShown).toBe(true);
		reveal.toggleAll();
		expect(seen).toEqual([true, false]);
	});

	it('a chapter change (reset) turns Show all off', () => {
		const seen: boolean[] = [];
		const reveal = createReveal({ onAll: (v) => seen.push(v) });
		reveal.toggleAll();
		reveal.reset();
		expect(reveal.isAllShown).toBe(false);
		expect(seen).toEqual([true, false]);
	});
});

describe('tapTarget', () => {
	it('finds the ruby with a concealed reading from its text or its rt', () => {
		const el = ruby(true);
		expect(tapTarget(el.firstChild!.parentElement)).toBe(el);
		expect(tapTarget(el.querySelector('rt'))).toBe(el);
	});
	it('ignores a ruby whose reading is shown and plain text', () => {
		const el = ruby(false);
		expect(tapTarget(el)).toBeNull();
		expect(tapTarget(document.body)).toBeNull();
		expect(tapTarget(null)).toBeNull();
	});
});

describe('tap tracking through the container', () => {
	function pointer(type: string, target: Element, x: number, y: number, id = 1): void {
		const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
		Object.defineProperty(e, 'pointerId', { value: id });
		target.dispatchEvent(e);
	}
	it('reveals on a still pointerup, not after a drag', () => {
		const el = ruby(true);
		const reveal = createReveal();
		const stop = reveal.attach(document.body);
		pointer('pointerdown', el, 10, 10);
		pointer('pointerup', el, 10 + TAP_SLOP_PX, 10);
		expect(el.classList.contains('revealed')).toBe(true);
		reveal.reset();
		pointer('pointerdown', el, 10, 10);
		pointer('pointerup', el, 10 + TAP_SLOP_PX + 1, 10);
		expect(el.classList.contains('revealed')).toBe(false);
		stop();
	});

	it('never stops the event for other listeners', () => {
		const el = ruby(true);
		const other = vi.fn();
		document.body.addEventListener('pointerdown', other);
		const reveal = createReveal();
		reveal.attach(document.body);
		pointer('pointerdown', el, 1, 1);
		expect(other).toHaveBeenCalledTimes(1);
	});
});

describe('revealKey', () => {
	const key = (over: Partial<Parameters<typeof revealKey>[0]> = {}) => ({
		key: 'r', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, defaultPrevented: false, ...over
	});
	it('R toggles in the reader', () => {
		expect(revealKey(key(), { busy: false })).toBe(true);
		expect(revealKey(key({ key: 'R' }), { busy: false })).toBe(true);
	});
	it('does nothing in a field, with modifiers, repeated, composing or handled', () => {
		expect(revealKey(key(), { busy: true })).toBe(false);
		for (const over of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }, { isComposing: true }, { defaultPrevented: true }, { key: 'x' }]) {
			expect(revealKey(key(over), { busy: false })).toBe(false);
		}
	});
});
