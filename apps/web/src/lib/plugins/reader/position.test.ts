import { describe, expect, it } from 'vitest';
import { formatPosition, parsePosition } from './position';

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
