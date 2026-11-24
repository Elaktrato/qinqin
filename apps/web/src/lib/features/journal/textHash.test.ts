import { describe, expect, it } from 'vitest';
import { textHash } from './textHash';

// The same vectors as the Go side (journal.TextHash).
describe('textHash', () => {
	it.each([
		['', 'fnv1a64:cbf29ce484222325'],
		['a', 'fnv1a64:af63dc4c8601ec8c'],
		['我今天去学校了。', 'fnv1a64:64861151b3ea2999'],
		['日本語を勉強します\n二行目', 'fnv1a64:b58bf112206ab312']
	])('hashes %j', (text, expected) => {
		expect(textHash(text)).toBe(expected);
	});
});
