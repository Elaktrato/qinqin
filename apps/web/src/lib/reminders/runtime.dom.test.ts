import { describe, expect, it, vi } from 'vitest';
import { REMINDERS_CHANGED, notifyRemindersChanged } from './runtime';

describe('notifyRemindersChanged', () => {
	it('dispatches the event the runtime listens to', () => {
		const spy = vi.fn();
		window.addEventListener(REMINDERS_CHANGED, spy);
		notifyRemindersChanged();
		expect(spy).toHaveBeenCalledTimes(1);
		window.removeEventListener(REMINDERS_CHANGED, spy);
	});
});
