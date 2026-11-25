import { describe, expect, it, vi } from 'vitest';
import { dismissTop, hasDismissable, registerDismissable } from './dismissStack';

describe('dismissStack', () => {
	it('is empty and handles nothing at first', () => {
		expect(hasDismissable()).toBe(false);
		expect(dismissTop()).toBe(false);
	});

	it('closes the innermost first and keeps the others', () => {
		const outer = vi.fn();
		const inner = vi.fn();
		const offOuter = registerDismissable(outer);
		const offInner = registerDismissable(inner);
		expect(dismissTop()).toBe(true);
		expect(inner).toHaveBeenCalledOnce();
		expect(outer).not.toHaveBeenCalled();
		offInner();
		expect(dismissTop()).toBe(true);
		expect(outer).toHaveBeenCalledOnce();
		offOuter();
		expect(hasDismissable()).toBe(false);
	});

	it('removing one from the middle leaves the order of the rest', () => {
		const a = vi.fn();
		const b = vi.fn();
		const c = vi.fn();
		const offA = registerDismissable(a);
		const offB = registerDismissable(b);
		const offC = registerDismissable(c);
		offB();
		dismissTop();
		expect(c).toHaveBeenCalledOnce();
		offC();
		dismissTop();
		expect(a).toHaveBeenCalledOnce();
		offA();
	});

	it('removing twice is harmless', () => {
		const off = registerDismissable(() => undefined);
		off();
		off();
		expect(hasDismissable()).toBe(false);
	});
});
