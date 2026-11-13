import { describe, expect, it } from 'vitest';
import { listboxKey } from './listbox';

describe('listboxKey', () => {
	it('moves down and up, clamped at the ends', () => {
		expect(listboxKey('ArrowDown', 0, 3)).toEqual({ action: 'move', index: 1 });
		expect(listboxKey('ArrowDown', 2, 3)).toEqual({ action: 'move', index: 2 });
		expect(listboxKey('ArrowUp', 2, 3)).toEqual({ action: 'move', index: 1 });
		expect(listboxKey('ArrowUp', 0, 3)).toEqual({ action: 'move', index: 0 });
	});

	it('starts from the edges when nothing is active', () => {
		expect(listboxKey('ArrowDown', -1, 3)).toEqual({ action: 'move', index: 0 });
		expect(listboxKey('ArrowUp', -1, 3)).toEqual({ action: 'move', index: 2 });
	});

	it('jumps with Home and End', () => {
		expect(listboxKey('Home', 1, 4)).toEqual({ action: 'move', index: 0 });
		expect(listboxKey('End', 1, 4)).toEqual({ action: 'move', index: 3 });
	});

	it('selects the active option with Enter or Space', () => {
		expect(listboxKey('Enter', 1, 3)).toEqual({ action: 'select', index: 1 });
		expect(listboxKey(' ', 2, 3)).toEqual({ action: 'select', index: 2 });
		expect(listboxKey('Enter', -1, 3)).toEqual({ action: 'none', index: -1 });
	});

	it('closes on Escape and leaves Tab alone', () => {
		expect(listboxKey('Escape', 1, 3)).toEqual({ action: 'close', index: 1 });
		expect(listboxKey('Tab', 1, 3)).toEqual({ action: 'none', index: 1 });
	});

	it('ignores other keys and empty lists', () => {
		expect(listboxKey('a', 1, 3)).toEqual({ action: 'none', index: 1 });
		expect(listboxKey('ArrowDown', -1, 0)).toEqual({ action: 'none', index: -1 });
		expect(listboxKey('End', -1, 0)).toEqual({ action: 'none', index: -1 });
		expect(listboxKey('Escape', -1, 0)).toEqual({ action: 'close', index: -1 });
	});
});
