// A short-lived cache of one value per workspace. Concurrent readers share
// one load in flight; a finished load is served for `ttl` ms; a failed
// load is never stored. `invalidate` drops the stored value and forgets a
// load in flight (its result still reaches the callers that asked, but is
// not stored). Values are shared between callers: they must not mutate them.

export interface WorkspaceCache<T> {
	/** The workspace's value: cached, joined to a load in flight, or loaded. `force` skips a cached value. */
	get(workspaceId: number, opts?: { force?: boolean }): Promise<T>;
	/** Drops the cached value (and forgets a load in flight) of one workspace, or of all. */
	invalidate(workspaceId?: number): void;
}

interface Slot<T> {
	/** Bumped by invalidate: a load started before it is not stored. */
	generation: number;
	cached: { data: T; at: number } | null;
	inFlight: Promise<T> | null;
}

/** createWorkspaceCache builds a cache around `load` (clock injected for tests). */
export function createWorkspaceCache<T>(
	load: (workspaceId: number) => Promise<T>,
	now: () => number,
	ttl: number
): WorkspaceCache<T> {
	const slots = new Map<number, Slot<T>>();

	function slot(workspaceId: number): Slot<T> {
		let found = slots.get(workspaceId);
		if (!found) {
			found = { generation: 0, cached: null, inFlight: null };
			slots.set(workspaceId, found);
		}
		return found;
	}

	return {
		get(workspaceId, opts = {}) {
			const s = slot(workspaceId);
			if (!opts.force && s.cached && now() - s.cached.at < ttl) {
				return Promise.resolve(s.cached.data);
			}
			// A load in flight started after the last invalidate: fresh enough
			// even for `force`.
			if (s.inFlight) return s.inFlight;
			const generation = s.generation;
			const promise = load(workspaceId).then(
				(data) => {
					if (s.generation === generation) {
						s.cached = { data, at: now() };
						s.inFlight = null;
					}
					return data;
				},
				(err: unknown) => {
					if (s.generation === generation) s.inFlight = null;
					throw err;
				}
			);
			s.inFlight = promise;
			return promise;
		},
		invalidate(workspaceId) {
			const targets = workspaceId === undefined ? [...slots.values()] : [slots.get(workspaceId)];
			for (const s of targets) {
				if (!s) continue;
				s.generation++;
				s.cached = null;
				s.inFlight = null;
			}
		}
	};
}
