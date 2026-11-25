// Work a session started must not go out after it ended (record 0009): the
// next requests carry the next user's token, and the tab-wide banner belongs
// to the next session. The event log refuses to post once disposed, and the
// outbox reports nothing to the tab after its session ended.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../i18n/reloadPage', () => ({ reloadPage: vi.fn() }));

import { setToken } from '../api/client';
import { memoryStorage, testContext, type TestContext } from '../testing/context';

let ctx: TestContext;
let posted: unknown[];
let hold: Promise<void> | null;
let release: () => void;

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage());
	setToken('test-token');
	posted = [];
	hold = null;
	ctx = testContext({
		routes: {
			'POST /api/events/batch': async (body: unknown) => {
				posted.push(body);
				if (hold !== null) await hold;
				return {};
			},
			'POST /api/auth/logout': () => ({})
		},
		deps: { local: () => localStorage }
	});
});

afterEach(() => {
	ctx.app.dispose();
	vi.unstubAllGlobals();
});

describe('the event log after its session ended', () => {
	it('post refuses and sends nothing', async () => {
		const events = ctx.session.events;
		ctx.app.auth.logout();
		await expect(events.post([{ id: 'x', workspaceId: 1, device: 'web', ts: 't', type: 'read', payload: null }])).rejects.toThrow();
		expect(posted).toEqual([]);
	});

	it('a session receipt that waited for the study day is not recorded', async () => {
		const session = ctx.session;
		let settle!: () => void;
		vi.spyOn(session.zone, 'settled').mockReturnValue(new Promise<void>((r) => (settle = r)));
		const waiting = session.events.recordSessionWhenSettled(7);
		ctx.app.auth.logout();
		settle();
		await waiting;
		await Promise.resolve();
		expect(posted).toEqual([]);
		expect([...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).filter((k) => k?.includes('session'))).toEqual([]);
	});
});

describe('the outbox after its session ended', () => {
	it('a flush that finishes after the end does not announce "All reviews sent." to the next session', async () => {
		const outbox = ctx.session.outbox;
		// The first send fails: the review waits in the queue.
		hold = Promise.reject(new Error('offline'));
		hold.catch(() => undefined);
		await outbox.recordReview(7, 'c1', 3);
		expect(outbox.pendingCount(1)).toBe(1);
		// The retry is held, then the session ends while it is in flight.
		hold = new Promise<void>((r) => (release = r));
		const flushing = outbox.flush();
		await vi.waitFor(() => expect(posted.length).toBe(2));
		ctx.app.auth.logout();
		release();
		await flushing;
		expect(ctx.app.offline.allSentAt).toBeNull();
	});
});
