import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import type { StudyEventBody } from '../api/types';
import { postEvents } from '../events';
import { emitStudyEvents, registerStudyEventHandler, setHookStates } from './hooks';

const event: StudyEventBody = {
	id: 'E1',
	workspaceId: 1,
	device: 'web',
	ts: '2026-11-15T10:00:00Z',
	type: 'journal',
	payload: null
};

function state(id: string, enabled: boolean) {
	return { id, manifest: {}, enabled, order: 0 };
}

describe('study-event hook', () => {
	const offs: (() => void)[] = [];
	beforeEach(() => {
		vi.stubGlobal('localStorage', { getItem: () => 'tok' });
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
	});
	afterEach(() => {
		offs.splice(0).forEach((off) => off());
		setHookStates(null);
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('calls a registered handler with the posted batch', async () => {
		const handler = vi.fn();
		offs.push(registerStudyEventHandler('p1', handler));
		await postEvents([event]);
		expect(handler).toHaveBeenCalledWith([event]);
	});

	it('unsubscribe stops delivery', () => {
		const handler = vi.fn();
		registerStudyEventHandler('p1', handler)();
		emitStudyEvents([event]);
		expect(handler).not.toHaveBeenCalled();
	});

	it('does not call a disabled plugin and counts unknown plugins as enabled', () => {
		const off = vi.fn();
		const on = vi.fn();
		const unknown = vi.fn();
		offs.push(registerStudyEventHandler('p1', off));
		offs.push(registerStudyEventHandler('p2', on));
		offs.push(registerStudyEventHandler('p3', unknown));
		setHookStates([state('p1', false), state('p2', true)]);
		emitStudyEvents([event]);
		expect(off).not.toHaveBeenCalled();
		expect(on).toHaveBeenCalledTimes(1);
		expect(unknown).toHaveBeenCalledTimes(1);
	});

	it('an empty state list (not loaded yet) runs no handler; null runs all', () => {
		const handler = vi.fn();
		offs.push(registerStudyEventHandler('p1', handler));
		setHookStates([]);
		emitStudyEvents([event]);
		expect(handler).not.toHaveBeenCalled();
		setHookStates(null);
		emitStudyEvents([event]);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('isolates an async handler rejection', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const next = vi.fn();
		offs.push(registerStudyEventHandler('p1', () => Promise.reject(new Error('late boom'))));
		offs.push(registerStudyEventHandler('p2', next));
		await expect(postEvents([event])).resolves.toBeUndefined();
		await new Promise((r) => setTimeout(r, 0));
		expect(next).toHaveBeenCalledTimes(1);
		expect(err).toHaveBeenCalledTimes(1);
	});

	it('hooks isolate a throwing handler', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const next = vi.fn();
		offs.push(
			registerStudyEventHandler('p1', () => {
				throw new Error('boom');
			})
		);
		offs.push(registerStudyEventHandler('p2', next));
		await expect(postEvents([event])).resolves.toBeUndefined();
		expect(next).toHaveBeenCalledTimes(1);
		expect(err).toHaveBeenCalledTimes(1);
	});
});
