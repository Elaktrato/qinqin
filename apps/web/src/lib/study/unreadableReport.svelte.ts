// The last study load's unreadable rows per workspace (record 0002), for the
// study page's notice, owned by the session's study state (record 0009). It
// logs one console warning per new report: collection, count and identities
// only, never row data.

import type { UnreadableCounts, UnreadableReport } from './unreadable';

export class UnreadableRows {
	#report = $state.raw<UnreadableReport | null>(null);
	#lastWarned = '';

	/** The last report, or null when the last load read every row. */
	get report(): UnreadableReport | null {
		return this.#report;
	}

	/** report records one load's unreadable rows (an empty count clears the workspace's report). */
	record(workspaceId: number, counts: UnreadableCounts, keys: readonly string[]): void {
		const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
		if (total === 0) {
			if (this.#report === null || this.#report.workspaceId === workspaceId) this.#report = null;
			return;
		}
		this.#report = { workspaceId, counts: { ...counts }, total };
		const signature = JSON.stringify([workspaceId, counts, keys]);
		if (signature === this.#lastWarned) return;
		this.#lastWarned = signature;
		const summary = Object.entries(counts).map(([collection, n]) => `${collection} ${n}`);
		console.warn(`study: skipped ${total} unreadable row(s) in workspace ${workspaceId}`, summary, 'kept unchanged:', keys);
	}

	clear(): void {
		this.#report = null;
		this.#lastWarned = '';
	}
}
