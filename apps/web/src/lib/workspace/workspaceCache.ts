// A short-lived cache of one value per workspace. Concurrent readers share
// one load in flight; a finished load is served for `ttl` ms; a failed
// load is never stored. `invalidate` drops the stored value and forgets a
// load in flight (its result still reaches the callers that asked, but is
// not stored). Values are shared between callers: they must not mutate them.
//
// With `revalidate` (#290) a held value older than `ttl`, or marked stale, is
// served at once and reloaded in the background: `refreshed` hears when the
// new value differs (`changed`), `failed` when the reload failed (the held
// value stays). `force` and a dropped value still wait.

export interface WorkspaceCache<T> {
	/** The workspace's value: cached, joined to a load in flight, or loaded. `force` skips a cached value. */
	get(workspaceId: number, opts?: { force?: boolean }): Promise<T>;
	/** Drops the cached value (and forgets a load in flight) of one workspace, or of all. */
	invalidate(workspaceId?: number): void;
	/** With revalidate: keeps the value but reloads it behind the next read. Without: invalidate. */
	markStale(workspaceId: number): void;
}

export interface Revalidate<T> {
	/** Whether a reloaded value differs from the held one. */
	changed(held: T, fresh: T): boolean;
	refreshed(workspaceId: number): void;
	failed(workspaceId: number, err: unknown): void;
	/** Called whenever a load was stored (a failure it follows is over). */
	stored?(workspaceId: number): void;
}

interface Slot<T> {
	/** Bumped by invalidate: a load started before it is not stored. */
	generation: number;
	cached: { data: T; at: number } | null;
	stale: boolean;
	inFlight: Promise<T> | null;
}

/** createWorkspaceCache builds a cache around `load` (clock injected for tests). */
export function createWorkspaceCache<T>(
	load: (workspaceId: number) => Promise<T>,
	now: () => number,
	ttl: number,
	opts: { revalidate?: Revalidate<T> } = {}
): WorkspaceCache<T> {
	const slots = new Map<number, Slot<T>>();
	const revalidate = opts.revalidate;

	function slot(workspaceId: number): Slot<T> {
		let found = slots.get(workspaceId);
		if (!found) {
			found = { generation: 0, cached: null, stale: false, inFlight: null };
			slots.set(workspaceId, found);
		}
		return found;
	}

	function start(workspaceId: number, s: Slot<T>): Promise<T> {
		const generation = s.generation;
		const held = s.cached;
		const promise = load(workspaceId).then(
			(data) => {
				if (s.generation === generation) {
					s.cached = { data, at: now() };
					s.stale = false;
					s.inFlight = null;
					revalidate?.stored?.(workspaceId);
				}
				return data;
			},
			(err: unknown) => {
				if (s.generation === generation) s.inFlight = null;
				throw err;
			}
		);
		s.inFlight = promise;
		if (revalidate !== undefined && held !== null) {
			promise.then(
				(data) => {
					if (s.generation === generation && revalidate.changed(held.data, data)) revalidate.refreshed(workspaceId);
				},
				(err: unknown) => {
					if (s.generation === generation) revalidate.failed(workspaceId, err);
				}
			);
		}
		return promise;
	}

	return {
		get(workspaceId, getOpts = {}) {
			const s = slot(workspaceId);
			const fresh = s.cached !== null && !s.stale && now() - s.cached.at < ttl;
			if (!getOpts.force && s.cached && fresh) {
				return Promise.resolve(s.cached.data);
			}
			if (!getOpts.force && s.cached && revalidate !== undefined) {
				// Stale-while-revalidate: the held value now, the reload behind it.
				if (s.inFlight === null) start(workspaceId, s).catch(() => undefined);
				return Promise.resolve(s.cached.data);
			}
			// A load in flight started after the last invalidate: fresh enough
			// even for `force`.
			if (s.inFlight) return s.inFlight;
			return start(workspaceId, s);
		},
		invalidate(workspaceId) {
			const targets = workspaceId === undefined ? [...slots.values()] : [slots.get(workspaceId)];
			for (const s of targets) {
				if (!s) continue;
				s.generation++;
				s.cached = null;
				s.stale = false;
				s.inFlight = null;
			}
		},
		markStale(workspaceId) {
			if (revalidate === undefined) {
				this.invalidate(workspaceId);
				return;
			}
			const s = slots.get(workspaceId);
			if (s === undefined) return;
			// A load in flight may have been read before the change: its answer must not count as fresh.
			s.generation++;
			s.inFlight = null;
			s.stale = true;
		}
	};
}
