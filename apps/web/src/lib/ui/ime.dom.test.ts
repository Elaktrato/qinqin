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

	it('ignores the Safari Enter after compositionend (keyCode 229), but never a genuine Enter (keyCode 13) right after commit', () => {
		document.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		document.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本' }));
		expect(isImeKey(key({ key: 'Enter', isComposing: false, keyCode: 229 }))).toBe(true);
		// Gboard commits a Latin word and sends a plain Enter within milliseconds: that Enter must act.
		expect(isImeKey(key({ key: 'Enter', isComposing: false, keyCode: 13 }))).toBe(false);
		expect(imeComposing()).toBe(false);
	});

	it('does not cancel the implicit submit of a genuine Enter right after compositionend', () => {
		const input = document.createElement('input');
		document.body.append(input);
		input.focus();
		input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'word' }));
		const enter = key({ key: 'Enter', keyCode: 13 });
		input.dispatchEvent(enter);
		expect(enter.defaultPrevented).toBe(false);
		input.remove();
	});

	it('drops the flag when the composing input loses focus without compositionend', () => {
		const input = document.createElement('input');
		document.body.append(input);
		input.focus();
		input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		expect(imeComposing()).toBe(true);
		input.blur();
		expect(imeComposing()).toBe(false);
		expect(isImeKey(key({ key: 'Enter', keyCode: 13 }))).toBe(false);
		input.remove();
	});

	it('drops the flag when the composing input is removed from the document', () => {
		const input = document.createElement('input');
		document.body.append(input);
		input.focus();
		input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		input.remove();
		expect(imeComposing()).toBe(false);
	});

	it('drops the flag when focus moves to another element', () => {
		const a = document.createElement('input');
		const b = document.createElement('input');
		document.body.append(a, b);
		a.focus();
		a.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
		expect(imeComposing()).toBe(true);
		b.focus();
		expect(imeComposing()).toBe(false);
		a.remove();
		b.remove();
	});

	it('cancels the default of an IME Enter in an input (no implicit form submission), not of a normal Enter', () => {
		const input = document.createElement('input');
		document.body.append(input);
		const ime = key({ key: 'Enter', keyCode: 229 });
		input.dispatchEvent(ime);
		expect(ime.defaultPrevented).toBe(true);
		vi.advanceTimersByTime(1000);
		const plain = key({ key: 'Enter', keyCode: 13 });
		input.dispatchEvent(plain);
		expect(plain.defaultPrevented).toBe(false);
		input.remove();
	});
});
