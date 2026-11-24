// The user's own "Sign out": one flush of unsent reviews first, and a dialog
// (LogoutDialog) when some remain. The plain `auth.logout()` stays the
// non-interactive path (expired or revoked session, delete account).

import type { AppContext } from '../context/app.svelte';
import { decideLogout } from './logoutFlow';

/**
 * requestSignOut flushes, then signs out or asks. The flush can take seconds;
 * what follows acts only on the session it started for: after a switch to
 * another user (another tab) it does nothing.
 */
export async function requestSignOut(app: AppContext): Promise<void> {
	const session = app.session;
	const id = session?.user ?? null;
	if (session === null || id === null) {
		app.auth.logout();
		return;
	}
	const { decision, count } = await decideLogout({
		pending: () => session.outbox.pendingCount(id),
		flush: () => session.outbox.flush()
	});
	if (app.session !== session || !session.alive) return;
	if (decision === 'signout') app.auth.logout();
	else app.logoutPrompt = count;
}

/** The dialog's "Sign out and delete them": the session's own user's reviews only. */
export function signOutAndDelete(app: AppContext): void {
	const session = app.session;
	const id = session?.alive ? session.user : null;
	if (session !== null && id !== null) session.outbox.clearPending(id);
	app.logoutPrompt = null;
	app.auth.logout();
}

/** The dialog's "Stay signed in" (also Escape). */
export function staySignedIn(app: AppContext): void {
	app.logoutPrompt = null;
}
