import { describe, expect, it } from 'vitest';
import { canSave, counterText, isOverCap } from './noteEditor';

describe('note editor rules', () => {
	it('counts code points after normalising', () => {
		expect(counterText('')).toBe('0 / 2000');
		expect(counterText('马😀  \n')).toBe('2 / 2000');
		expect(counterText('a'.repeat(2001))).toBe('2001 / 2000');
	});

	it('flags text over the cap', () => {
		expect(isOverCap('a'.repeat(2000))).toBe(false);
		expect(isOverCap('a'.repeat(2001))).toBe(true);
	});

	it('allows a save only when it changes something and fits', () => {
		expect(canSave('hello', null)).toBe(true);
		expect(canSave('hello  ', 'hello')).toBe(false); // the same after normalising
		expect(canSave('hello!', 'hello')).toBe(true);
		expect(canSave('', null)).toBe(false); // nothing to delete
		expect(canSave('  ', 'hello')).toBe(true); // a delete
		expect(canSave('a'.repeat(2001), null)).toBe(false);
	});
});
