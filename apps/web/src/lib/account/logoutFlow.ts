// Signing out with reviews that were never sent: ask instead of silently
// keeping or dropping them. Pure decision plus the wording; the dialog and
// signOut.ts call it (the open dialog's count is the app context's
// `logoutPrompt`).

import { t } from '$lib/i18n';

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
	/** How long the flush may take before the user is asked anyway (default 8 s). */
	timeoutMs?: number;
}): Promise<LogoutDecision> {
	if (deps.pending() === 0) return { decision: 'signout', count: 0 };
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			deps.flush(),
			new Promise<void>((resolve) => {
				timer = setTimeout(resolve, deps.timeoutMs ?? 8000);
			})
		]);
	} catch {
		// Falls through: the count decides.
	} finally {
		clearTimeout(timer);
	}
	const count = deps.pending();
	return count === 0 ? { decision: 'signout', count: 0 } : { decision: 'ask', count };
}

export function unsentText(count: number): string {
	return t('account.logout.unsent', { count });
}
