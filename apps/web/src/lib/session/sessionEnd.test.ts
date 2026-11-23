import { afterEach, describe, expect, it, vi } from 'vitest';

import { endSession, onSessionEnd, sessionEpoch } from './sessionEnd';

const off: (() => void)[] = [];
afterEach(() => {
	for (const fn of off.splice(0)) fn();
	vi.restoreAllMocks();
});

describe('onSessionEnd / endSession', () => {
	it('runs every registered function in registration order with the reason', () => {
		const seen: string[] = [];
		off.push(onSessionEnd((reason) => seen.push(`a:${reason}`)));
		off.push(onSessionEnd((reason) => seen.push(`b:${reason}`)));
		endSession('signOut');
		endSession('expired');
		expect(seen).toEqual(['a:signOut', 'b:signOut', 'a:expired', 'b:expired']);
	});

	it('an unregistered function no longer runs', () => {
		const fn = vi.fn();
		const unregister = onSessionEnd(fn);
		unregister();
		endSession('switched');
		expect(fn).not.toHaveBeenCalled();
	});

	it('a throwing function is logged and does not stop the others', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const after = vi.fn();
		off.push(
			onSessionEnd(() => {
				throw new Error('boom');
			})
		);
		off.push(onSessionEnd(after));
		endSession('signOut');
		expect(after).toHaveBeenCalledWith('signOut');
		expect(error).toHaveBeenCalledTimes(1);
	});

	it('moves the epoch, and the functions see the old one', () => {
		const before = sessionEpoch();
		let during = -1;
		off.push(onSessionEnd(() => (during = sessionEpoch())));
		endSession('expired');
		expect(during).toBe(before);
		expect(sessionEpoch()).toBe(before + 1);
	});
});
