import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imeComposing, isImeKey } from './ime';

function key(init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
	const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
	if (init.keyCode !== undefined) Object.defineProperty(e, 'keyCode', { value: init.keyCode });
	return e;
}

describe('isImeKey', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
		vi.advanceTimersByTime(1000);
		vi.useRealTimers();
	});

	it('is true for isComposing and for keyCode 229, false for a plain Enter', () => {
		expect(isImeKey(key({ key: 'Enter', isComposing: true }))).toBe(true);
		expect(isImeKey(key({ key: 'Enter', keyCode: 229 }))).toBe(true);
		expect(isImeKey(key({ key: 'Enter', keyCode: 13 }))).toBe(false);
		expect(isImeKey(key({ key: 'Escape' }))).toBe(false);
	});

	it('is true between compositionstart and compositionend even when isComposing is false (Gboard)', () => {
		document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		document.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'に' }));
		expect(imeComposing()).toBe(true);
		expect(isImeKey(key({ key: 'Enter', isComposing: false }))).toBe(true);
	});

	it('still ignores the Enter that Safari sends right after compositionend, then lets later Enters through', () => {
		document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本' }));
		expect(isImeKey(key({ key: 'Enter', isComposing: false }))).toBe(true);
		vi.advanceTimersByTime(100);
		expect(isImeKey(key({ key: 'Enter', isComposing: false }))).toBe(false);
		expect(imeComposing()).toBe(false);
	});
});
