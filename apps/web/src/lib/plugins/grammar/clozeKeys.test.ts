import { describe, expect, it } from 'vitest';
import { choiceForKey } from './clozeKeys';

describe('choiceForKey', () => {
	it('maps keys 1-5 to choice indexes within range', () => {
		expect(choiceForKey('1', 3)).toBe(0);
		expect(choiceForKey('3', 3)).toBe(2);
		expect(choiceForKey('4', 3)).toBeNull();
		expect(choiceForKey('5', 5)).toBe(4);
	});
	it('ignores other keys', () => {
		expect(choiceForKey('0', 3)).toBeNull();
		expect(choiceForKey('6', 5)).toBeNull();
		expect(choiceForKey('a', 3)).toBeNull();
		expect(choiceForKey('12', 3)).toBeNull();
	});
});
