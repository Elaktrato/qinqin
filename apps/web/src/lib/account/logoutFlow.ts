// Signing out with reviews that were never sent: ask instead of silently
// keeping or dropping them. Pure decision plus the wording; the dialog and
// the auth store call it.

import { writable } from 'svelte/store';

export interface LogoutDecision {
	decision: 'signout' | 'ask';
	/** Reviews still unsent after the flush. */
	count: number;
}

/**
 * decideLogout tries one flush when something is queued; if reviews remain
 * (offline, server down, a failing flush) the user is asked.
 */
export async function decideLogout(deps: {
	pending: () => number;
	flush: () => Promise<void>;
}): Promise<LogoutDecision> {
	if (deps.pending() === 0) return { decision: 'signout', count: 0 };
	try {
		await deps.flush();
	} catch {
		// Falls through: the count decides.
	}
	const count = deps.pending();
	return count === 0 ? { decision: 'signout', count: 0 } : { decision: 'ask', count };
}

export function unsentText(count: number): string {
	return count === 1
		? '1 review has not been sent yet. If you sign out now it is deleted from this device.'
		: `${count} reviews have not been sent yet. If you sign out now they are deleted from this device.`;
}

/** The number of unsent reviews the sign-out dialog is asking about; null = no dialog. */
export const logoutPrompt = writable<number | null>(null);
