// The saved study setups of the session's user (record 0009: owned by the
// Session), one per workspace: the keyed row `study-setup` (setup.ts). A
// workspace's setup answers at once from memory or the device cache, then from
// the server (`refresh`); a change paints at once and is written over the
// re-read row, one write after another per workspace. A write that failed is
// kept on the device as unsaved and written again at the next refresh, so a
// change made offline is never silently replaced by the server's older value.

import { untrack } from 'svelte';
import { parseSetup, withSetup, type StudySetup } from './setup';

const CACHE_PREFIX = 'qinqin.study.setup.';

/** The device cache key of one user's setup in one workspace. */
export function setupCacheKey(user: number, workspaceId: number): string {
	return `${CACHE_PREFIX}${user}.${workspaceId}`;
}

/** The workspace a setup cache key belongs to, or null when `key` is no such key. */
export function setupCacheWorkspace(key: string): number | null {
	const match = /^qinqin\.study\.setup\.\d+\.(\d+)$/.exec(key);
	return match === null ? null : Number(match[1]);
}

export interface StudySetupsDeps {
	/** The stored row's data, or null when there is none. */
	load(workspaceId: number): Promise<unknown | null>;
	save(workspaceId: number, data: unknown): Promise<void>;
	local(): Storage | null;
	user(): number | null;
	alive(): boolean;
}

export interface SetupEntry {
	setup: StudySetup;
	/** The stored row as last read or written (what a write merges over). */
	raw: unknown;
	/** True once the server answered in this session. */
	loaded: boolean;
	/** The error of the last write, while the change is unsaved. */
	saveError: unknown | null;
}

interface Cached {
	raw: unknown;
	dirty: boolean;
}

export class StudySetups {
	readonly #deps: StudySetupsDeps;
	#entries = $state.raw<Record<number, SetupEntry>>({});
	// Plain bookkeeping (not shown): writes begun per workspace, and each workspace's write queue.
	readonly #writes = new Map<number, number>();
	readonly #queue = new Map<number, Promise<void>>();

	constructor(deps: StudySetupsDeps) {
		this.#deps = deps;
	}

	/** of: the workspace's setup now (memory, else the device cache, else the defaults). */
	of(workspaceId: number): SetupEntry {
		const known = this.#entries[workspaceId];
		if (known !== undefined) return known;
		const cached = this.#readCache(workspaceId);
		return {
			setup: parseSetup(cached?.raw ?? null),
			raw: cached?.raw ?? null,
			loaded: false,
			saveError: cached?.dirty ? 'unsaved' : null
		};
	}

	/** refresh reads the row from the server; an unsaved change on this device is written instead. */
	async refresh(workspaceId: number): Promise<void> {
		if (!this.#deps.alive()) return;
		// Untracked: callers refresh from an effect, which must not depend on what the refresh writes.
		const current = untrack(() => this.of(workspaceId));
		if (current.saveError !== null) return this.update(workspaceId, current.setup);
		const epoch = this.#writes.get(workspaceId) ?? 0;
		try {
			const raw = await this.#deps.load(workspaceId);
			if (!this.#deps.alive() || epoch !== (this.#writes.get(workspaceId) ?? 0)) return;
			this.#set(workspaceId, { setup: parseSetup(raw), raw, loaded: true, saveError: null });
			this.#writeCache(workspaceId, { raw, dirty: false });
		} catch {
			// Offline or a failed read: keep what is shown.
		}
	}

	/** update shows `next` at once and writes it over the re-read row (after the workspace's earlier writes). */
	update(workspaceId: number, next: StudySetup): Promise<void> {
		if (!this.#deps.alive()) return Promise.resolve();
		const mine = (this.#writes.get(workspaceId) ?? 0) + 1;
		this.#writes.set(workspaceId, mine);
		const before = untrack(() => this.of(workspaceId));
		const optimistic = withSetup(before.raw, next);
		this.#set(workspaceId, { setup: next, raw: before.raw, loaded: before.loaded, saveError: null });
		this.#writeCache(workspaceId, { raw: optimistic, dirty: true });
		const run = async (): Promise<void> => {
			if (!this.#deps.alive()) return;
			try {
				const fresh = await this.#deps.load(workspaceId);
				const data = withSetup(fresh, next);
				await this.#deps.save(workspaceId, data);
				if (!this.#deps.alive() || mine !== this.#writes.get(workspaceId)) return;
				this.#set(workspaceId, { setup: next, raw: data, loaded: true, saveError: null });
				this.#writeCache(workspaceId, { raw: data, dirty: false });
			} catch (err) {
				if (!this.#deps.alive() || mine !== this.#writes.get(workspaceId)) return;
				this.#set(workspaceId, { ...untrack(() => this.of(workspaceId)), saveError: err ?? 'failed' });
			}
		};
		const queued = (this.#queue.get(workspaceId) ?? Promise.resolve()).then(run);
		this.#queue.set(workspaceId, queued);
		return queued;
	}

	/** forget removes every cached setup from the device (a sign-out). */
	forget(): void {
		const local = this.#deps.local();
		if (local === null) return;
		try {
			const doomed: string[] = [];
			for (let i = 0; i < local.length; i++) {
				const key = local.key(i);
				if (key !== null && key.startsWith(CACHE_PREFIX)) doomed.push(key);
			}
			for (const key of doomed) local.removeItem(key);
		} catch {
			// Storage denied: nothing was cached either.
		}
	}

	#set(workspaceId: number, entry: SetupEntry): void {
		this.#entries = { ...untrack(() => this.#entries), [workspaceId]: entry };
	}

	#readCache(workspaceId: number): Cached | null {
		const user = this.#deps.user();
		if (user === null) return null;
		try {
			const text = this.#deps.local()?.getItem(setupCacheKey(user, workspaceId));
			if (!text) return null;
			const parsed = JSON.parse(text) as Partial<Cached>;
			return typeof parsed === 'object' && parsed !== null ? { raw: parsed.raw ?? null, dirty: parsed.dirty === true } : null;
		} catch {
			return null;
		}
	}

	#writeCache(workspaceId: number, value: Cached): void {
		const user = this.#deps.user();
		if (user === null) return;
		try {
			this.#deps.local()?.setItem(setupCacheKey(user, workspaceId), JSON.stringify(value));
		} catch {
			// A full or blocked storage only costs the instant paint after a reload.
		}
	}
}
