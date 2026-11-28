// The session's failed background refreshes (#290), owned by the session's
// study state (record 0009). A page that shows held rows while they refresh
// (the study cache and the event log serve what they hold at once) shows a
// quiet notice while the last refresh of its workspace failed; the next
// refresh that lands clears it.

export type RefreshSource = 'study' | 'log';

export class RefreshReport {
	#failed = $state.raw<ReadonlySet<string>>(new Set());

	/** failed: whether the last background refresh of the workspace's rows or log failed. */
	failed(workspaceId: number): boolean {
		return this.#failed.has(`study:${workspaceId}`) || this.#failed.has(`log:${workspaceId}`);
	}

	/** record notes how a refresh of one source ended. */
	record(source: RefreshSource, workspaceId: number, ok: boolean): void {
		const key = `${source}:${workspaceId}`;
		if (this.#failed.has(key) !== ok) return;
		const next = new Set(this.#failed);
		if (ok) next.delete(key);
		else next.add(key);
		this.#failed = next;
	}

	/** clear forgets every failure (the session end). */
	clear(): void {
		this.#failed = new Set();
	}
}
