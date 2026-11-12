import { describe, expect, it } from 'vitest';
import { libraryKey } from './libraryKey';

describe('libraryKey', () => {
	it('separates equal ids from different sources', () => {
		expect(libraryKey('gutenberg', '42')).not.toBe(libraryKey('aozora', '42'));
		expect(libraryKey('gutenberg', '42')).toBe('gutenberg:42');
	});
});
