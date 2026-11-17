import { describe, expect, it } from 'vitest';
import { chapterTitle, formatPosition, parsePosition, savedChapter } from './position';

describe('formatPosition', () => {
	it('formats chapter and paragraph', () => {
		expect(formatPosition(0, 0)).toBe('0:0');
		expect(formatPosition(3, 17)).toBe('3:17');
	});
});

describe('parsePosition', () => {
	it('parses a formatted position', () => {
		expect(parsePosition('3:17')).toEqual({ chapter: 3, paragraph: 17 });
		expect(parsePosition(formatPosition(0, 5))).toEqual({ chapter: 0, paragraph: 5 });
	});

	it('rejects anything but two non-negative integers', () => {
		for (const bad of ['', '3', '3:', ':4', '-1:2', '1:-2', '1.5:2', '1:2:3', ' 1:2', 'a:b', '1e2:0']) {
			expect(parsePosition(bad)).toBeNull();
		}
		expect(parsePosition('99999999999999999999:0')).toBeNull();
	});
});

describe('savedChapter', () => {
	it('is the chapter of the saved position', () => {
		expect(savedChapter('3:17', 10)).toBe(3);
	});

	it('clamps to the last chapter', () => {
		expect(savedChapter('12:0', 10)).toBe(9);
		expect(savedChapter('5:0', 0)).toBe(0);
	});

	it('is 0 for a missing or malformed position', () => {
		expect(savedChapter('', 10)).toBe(0);
		expect(savedChapter('x:1', 10)).toBe(0);
	});
});

describe('chapterTitle', () => {
	it('is the chapter title when there is one', () => {
		expect(chapterTitle('序章', 0)).toBe('序章');
	});

	it('is "Chapter n" (1-based) for an empty title', () => {
		expect(chapterTitle('', 0)).toBe('Chapter 1');
		expect(chapterTitle('  ', 4)).toBe('Chapter 5');
	});
});
