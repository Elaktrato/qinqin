// The signed-in user as the study reads see it (data.ts, goals, milestones)
// until #196 moves those reads into the session: the app context mirrors the
// session's user here. The review outbox itself reads the session.

let current: number | null = null;

/** setOutboxUser records the signed-in user (null when signed out or not yet known). */
export function setOutboxUser(id: number | null): void {
	current = id;
}

export function outboxUser(): number | null {
	return current;
}
