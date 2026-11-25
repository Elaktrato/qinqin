import { describe, expect, it, vi } from 'vitest';
import { onBack, type BackDeps } from './back';

function deps(over: Partial<BackDeps> = {}): BackDeps {
	return { dismiss: () => false, escape: () => false, goBack: vi.fn(), leave: vi.fn(), ...over };
}

describe('onBack: overlays first, then history, then leave', () => {
	it('closes an open overlay and does nothing else', () => {
		const d = deps({ dismiss: () => true });
		expect(onBack(true, d)).toBe('overlay');
		expect(d.goBack).not.toHaveBeenCalled();
		expect(d.leave).not.toHaveBeenCalled();
	});

	it('offers Escape to an overlay the registry does not know', () => {
		const d = deps({ escape: () => true });
		expect(onBack(true, d)).toBe('escape');
		expect(d.goBack).not.toHaveBeenCalled();
	});

	it('goes back in the history when nothing is open', () => {
		const d = deps();
		expect(onBack(true, d)).toBe('history');
		expect(d.goBack).toHaveBeenCalledOnce();
		expect(d.leave).not.toHaveBeenCalled();
	});

	it('leaves the app at the start of the history', () => {
		const d = deps();
		expect(onBack(false, d)).toBe('leave');
		expect(d.leave).toHaveBeenCalledOnce();
		expect(d.goBack).not.toHaveBeenCalled();
	});

	it('an overlay wins even at the start of the history', () => {
		const d = deps({ dismiss: () => true });
		expect(onBack(false, d)).toBe('overlay');
		expect(d.leave).not.toHaveBeenCalled();
	});
});
