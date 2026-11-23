// The end of a session, in one place (#173). Every module that keeps per-user
// data in memory registers its clear function when that cache is created
// (module level): `onSessionEnd(() => cache.clear())`. auth.ts calls
// endSession when the user signs out, when a 401 ends the session, and when
// the signed-in user changes under this tab (another tab signed in as someone
// else). A load that stores its answer after an `await` captures
// sessionEpoch() first and stores only if it has not moved, so an answer
// requested for the previous user never lands after the clear.
// sessionCaches.lint.test.ts flags a module cache that does not register.

/** Why the session ended: only `signOut` also forgets the device's workspace choice. */
export type SessionEndReason = 'signOut' | 'expired' | 'switched';

type Clear = (reason: SessionEndReason) => void;

const clears: Clear[] = [];
let epoch = 0;

/** onSessionEnd registers `fn` to run at every session end; returns the unregister. */
export function onSessionEnd(fn: Clear): () => void {
	clears.push(fn);
	return () => {
		const at = clears.indexOf(fn);
		if (at >= 0) clears.splice(at, 1);
	};
}

/** sessionEpoch: bumped by every endSession. */
export function sessionEpoch(): number {
	return epoch;
}

/** endSession runs every registered clear (a throwing one is logged, the rest still run), then bumps the epoch. */
export function endSession(reason: SessionEndReason): void {
	for (const fn of [...clears]) {
		try {
			fn(reason);
		} catch (err) {
			console.error('session end: a cache could not be cleared', err);
		}
	}
	epoch += 1;
}
