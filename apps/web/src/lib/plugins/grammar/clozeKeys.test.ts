import { describe, expect, it } from 'vitest';
import { choiceForKey, choiceForKeyEvent } from './clozeKeys';

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

describe('choiceForKeyEvent', () => {
	const ev = (over: Record<string, unknown> = {}) => ({
		key: '2',
		ctrlKey: false,
		metaKey: false,
		altKey: false,
		isComposing: false,
		target: { tagName: 'BUTTON' },
		...over
	});
	it('maps a plain key press', () => {
		expect(choiceForKeyEvent(ev(), 3)).toBe(1);
		expect(choiceForKeyEvent(ev({ target: null }), 3)).toBe(1);
	});
	it('ignores modified keys and composition', () => {
		expect(choiceForKeyEvent(ev({ ctrlKey: true }), 3)).toBeNull();
		expect(choiceForKeyEvent(ev({ metaKey: true }), 3)).toBeNull();
		expect(choiceForKeyEvent(ev({ altKey: true }), 3)).toBeNull();
		expect(choiceForKeyEvent(ev({ isComposing: true }), 3)).toBeNull();
	});
	it('ignores keys typed into a field', () => {
		expect(choiceForKeyEvent(ev({ target: { tagName: 'INPUT', type: 'text' } }), 3)).toBeNull();
		expect(choiceForKeyEvent(ev({ target: { tagName: 'TEXTAREA' } }), 3)).toBeNull();
		expect(choiceForKeyEvent(ev({ target: { tagName: 'SELECT' } }), 3)).toBeNull();
		expect(choiceForKeyEvent(ev({ target: { tagName: 'DIV', isContentEditable: true } }), 3)).toBeNull();
		expect(choiceForKeyEvent(ev({ target: { tagName: 'INPUT', type: 'checkbox' } }), 3)).toBe(1);
	});
});
