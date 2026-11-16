// Who the review outbox belongs to. The auth store sets it (a tiny module of
// its own so auth.ts and study/events.ts need not import each other): queued
// reviews carry this id, and only this user's items are ever sent.

let current: number | null = null;
// The token `current` was loaded with: a flush is bound to this pair.
let currentToken: string | null = null;
const listeners = new Set<(id: number) => void>();

/** setOutboxUser records the signed-in user (null when signed out or not yet known). */
export function setOutboxUser(id: number | null, token: string | null): void {
	const changed = id !== current || token !== currentToken;
	current = id;
	currentToken = id === null ? null : token;
	if (changed && id !== null) for (const listener of [...listeners]) listener(id);
}

export function outboxUser(): number | null {
	return current;
}

/** The bearer token the outbox user was loaded with (null when none). */
export function outboxToken(): string | null {
	return currentToken;
}

/** onOutboxUser calls `listener` whenever a (different) user becomes known; returns the unsubscribe. */
export function onOutboxUser(listener: (id: number) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Test hook: forget every listener (a started outbox of an earlier test must not react). */
export function resetOutboxUserForTests(): void {
	listeners.clear();
}
