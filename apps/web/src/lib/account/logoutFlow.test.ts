import { describe, expect, it, vi } from 'vitest';
import { decideLogout, unsentText } from './logoutFlow';

describe('decideLogout', () => {
	it('signs out at once when nothing is waiting (no flush needed)', async () => {
		const flush = vi.fn(async () => {});
		expect(await decideLogout({ pending: () => 0, flush })).toEqual({ decision: 'signout', count: 0 });
		expect(flush).not.toHaveBeenCalled();
	});

	it('flushes once and signs out when that empties the queue', async () => {
		let n = 3;
		const flush = vi.fn(async () => {
			n = 0;
		});
		expect(await decideLogout({ pending: () => n, flush })).toEqual({ decision: 'signout', count: 0 });
		expect(flush).toHaveBeenCalledTimes(1);
	});

	it('asks when reviews are still unsent after the flush', async () => {
		const flush = vi.fn(async () => {});
		expect(await decideLogout({ pending: () => 2, flush })).toEqual({ decision: 'ask', count: 2 });
		expect(flush).toHaveBeenCalledTimes(1);
	});

	it('a failing flush still asks instead of signing out silently', async () => {
		const flush = vi.fn(async () => {
			throw new Error('x');
		});
		expect((await decideLogout({ pending: () => 1, flush })).decision).toBe('ask');
	});
});

describe('unsentText', () => {
	it('words the consequence in singular and plural', () => {
		expect(unsentText(1)).toBe('1 review has not been sent yet. If you sign out now it is deleted from this device.');
		expect(unsentText(3)).toBe('3 reviews have not been sent yet. If you sign out now they are deleted from this device.');
	});
});
