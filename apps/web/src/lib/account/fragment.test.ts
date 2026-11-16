import { describe, expect, it } from 'vitest';
import { readFragment } from './fragment';

describe('readFragment', () => {
	it('reads the invite and returns the cleaned URL', () => {
		expect(readFragment('#invite=abc_DEF-123', 'invite', '/register')).toEqual({
			value: 'abc_DEF-123',
			cleaned: '/register'
		});
	});
	it('reads t among other keys and keeps the search', () => {
		expect(readFragment('#x=1&t=tok', 't', '/reset?a=b').value).toBe('tok');
		expect(readFragment('#x=1&t=tok', 't', '/reset?a=b').cleaned).toBe('/reset?a=b');
	});
	it('is null for a missing, empty or unrelated fragment', () => {
		expect(readFragment('', 'invite', '/register').value).toBeNull();
		expect(readFragment('#invite=', 'invite', '/register').value).toBeNull();
		expect(readFragment('#other=1', 'invite', '/register').value).toBeNull();
	});
});
