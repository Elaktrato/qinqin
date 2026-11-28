// Enter submits a typed answer only when no IME composition is under way (the Android WebView sends keyCode 229).
import { describe, expect, it } from 'vitest';
import { submitsAnswer } from './ime';

const key = (over: Partial<KeyboardEvent>) => ({ key: 'Enter', isComposing: false, keyCode: 13, shiftKey: false, ...over }) as KeyboardEvent;

describe('Enter in the answer field', () => {
	it('submits a plain Enter', () => {
		expect(submitsAnswer(key({}), false)).toBe(true);
	});
	it('never while composing: the event says so, the WebView sends 229, or a composition is open', () => {
		expect(submitsAnswer(key({ isComposing: true }), false)).toBe(false);
		expect(submitsAnswer(key({ keyCode: 229 }), false)).toBe(false);
		expect(submitsAnswer(key({}), true)).toBe(false);
	});
	it('only Enter, without Shift', () => {
		expect(submitsAnswer(key({ key: 'a' }), false)).toBe(false);
		expect(submitsAnswer(key({ shiftKey: true }), false)).toBe(false);
	});
});
