import { describe, expect, it } from 'vitest';
import { libraryKey } from './libraryKey';

describe('libraryKey', () => {
	it('separates equal ids from different sources', () => {
		expect(libraryKey(7, 'gutenberg', '42')).not.toBe(libraryKey(7, 'aozora', '42'));
		expect(libraryKey(7, 'gutenberg', '42')).toBe('7:gutenberg:42');
	});

	it('separates the same work in different workspaces', () => {
		expect(libraryKey(7, 'aozora', '42')).not.toBe(libraryKey(8, 'aozora', '42'));
	});
});
