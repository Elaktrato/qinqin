// The user's own "Sign out": one flush of unsent reviews first, and a dialog
// (LogoutDialog) when some remain. The plain `auth.logout()` stays the
// non-interactive path (expired or revoked session, delete account).

import type { AppContext } from '../context/app.svelte';
import { decideLogout, logoutPrompt } from './logoutFlow';

export async function requestSignOut(app: AppContext): Promise<void> {
	const id = app.auth.user?.id;
	const outbox = app.session?.outbox;
	if (id === undefined || outbox === undefined) {
		app.auth.logout();
		return;
	}
	const { decision, count } = await decideLogout({
		pending: () => outbox.pendingCount(id),
		flush: () => outbox.flush()
	});
	if (decision === 'signout') app.auth.logout();
	else logoutPrompt.set(count);
}

/** The dialog's "Sign out and delete them". */
export function signOutAndDelete(app: AppContext): void {
	const id = app.auth.user?.id;
	if (id !== undefined) app.session?.outbox.clearPending(id);
	logoutPrompt.set(null);
	app.auth.logout();
}

/** The dialog's "Stay signed in" (also Escape). */
export function staySignedIn(): void {
	logoutPrompt.set(null);
}
