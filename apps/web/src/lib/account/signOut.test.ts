// The user's own sign-out (record 0009): its flush may take seconds, and a
// session switch may happen meanwhile (another tab signed in as someone
// else). What follows the flush acts only on the session it started for.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../i18n/reloadPage', () => ({ reloadPage: vi.fn() }));

import { setToken } from '../api/client';
import { createAppContext, type AppContext } from '../context/app.svelte';
import { fakeDeps, memoryStorage, testUser } from '../testing/context';
import { requestSignOut, signOutAndDelete } from './signOut';

let app: AppContext;

beforeEach(() => {
	vi.stubGlobal('localStorage', memoryStorage());
	app = createAppContext(fakeDeps({ 'POST /api/auth/logout': () => undefined }, { local: () => localStorage }));
	setToken('tok-A');
	app.auth.set({ token: 'tok-A', user: testUser({ id: 1 }) });
});

afterEach(() => {
	app.dispose();
	vi.unstubAllGlobals();
});

/** A's sign-out with two reviews waiting and a flush held until released. */
function heldSignOut(left = 2): { done: Promise<void>; release: () => void } {
	const outbox = app.session!.outbox;
	let release!: () => void;
	let flushed = false;
	vi.spyOn(outbox, 'pendingCount').mockImplementation(() => (flushed ? left : 2));
	vi.spyOn(outbox, 'flush').mockImplementation(
		() => new Promise<void>((r) => (release = () => ((flushed = true), r())))
	);
	return { done: requestSignOut(app), release: () => release() };
}

function switchToB(): void {
	setToken('tok-B');
	app.auth.set({ token: 'tok-B', user: testUser({ id: 2 }) });
}

describe('requestSignOut', () => {
	it('a flush that outlives a switch to another user neither signs B out nor opens the prompt over B', async () => {
		const { done, release } = heldSignOut();
		switchToB();
		const b = app.session!;
		release();
		await done;
		expect(app.session).toBe(b);
		expect(b.alive).toBe(true);
		expect(app.auth.token).toBe('tok-B');
		expect(app.logoutPrompt).toBeNull();
	});

	it('a flush that sent everything after a switch to another user does not sign B out', async () => {
		const { done, release } = heldSignOut(0);
		switchToB();
		const b = app.session!;
		release();
		await done;
		expect(b.alive).toBe(true);
		expect(app.auth.token).toBe('tok-B');
	});

	it('with reviews left after the flush, the prompt opens for the same session', async () => {
		const { done, release } = heldSignOut();
		release();
		await done;
		expect(app.logoutPrompt).toBe(2);
	});
});

describe('signOutAndDelete', () => {
	it("deletes the unsent reviews of the session's own user", () => {
		const session = app.session!;
		const clear = vi.spyOn(session.outbox, 'clearPending');
		app.logoutPrompt = 2;
		signOutAndDelete(app);
		expect(clear).toHaveBeenCalledWith(1);
		expect(app.session).toBeNull();
	});

	it('deletes nothing when the prompt was closed by a session switch (it asked the previous user)', async () => {
		const { done, release } = heldSignOut();
		switchToB();
		const clear = vi.spyOn(app.session!.outbox, 'clearPending');
		release();
		await done;
		signOutAndDelete(app);
		expect(clear).not.toHaveBeenCalled();
	});
});
