// The user's own "Sign out": one flush of unsent reviews first, and a dialog
// (LogoutDialog) when some remain. The plain logout() in auth.ts stays the
// non-interactive path (expired or revoked session, delete account).

import { get } from 'svelte/store';
import { auth, logout } from '../auth';
import { clearPending, flushPendingReviews, pendingCount } from '../study/events';
import { decideLogout, logoutPrompt } from './logoutFlow';

export async function requestSignOut(): Promise<void> {
	const id = get(auth).user?.id;
	if (id === undefined) {
		logout();
		return;
	}
	const { decision, count } = await decideLogout({
		pending: () => pendingCount(id),
		flush: flushPendingReviews
	});
	if (decision === 'signout') logout();
	else logoutPrompt.set(count);
}

/** The dialog's "Sign out and delete them". */
export function signOutAndDelete(): void {
	const id = get(auth).user?.id;
	if (id !== undefined) clearPending(id);
	logoutPrompt.set(null);
	logout();
}

/** The dialog's "Stay signed in" (also Escape). */
export function staySignedIn(): void {
	logoutPrompt.set(null);
}
