// The saved study setups of the session's user (record 0009: owned by the
// Session), one per workspace: the keyed row `study-setup` (setup.ts). A
// workspace's setup answers at once from memory or the device cache, then from
// the server (`refresh`).
//
// A change is a patch: only the members the learner changed. It paints at once
// and is written over the row read again from the server just before the write,
// so a member another device changed meanwhile, or one this device never loaded
// (a cold start), is never overwritten (review of 2026-11-25). Writes run one
// after another per workspace. A write that fails for a reason that may pass
// (offline, a busy server) keeps its patch on the device and is written again
// at the next refresh, which reads the server first; a refusal (another 4xx)
// drops the patch and says so.

import { untrack } from 'svelte';
import { parseSetup, withSetup, type StudySetup } from './setup';

const CACHE_PREFIX = 'qinqin.study.setup.';

/** A change of the setup: the members it sets. */
export type SetupPatch = Partial<Omit<StudySetup, 'version'>>;

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
	/** False once the workspace was deleted: nothing more is cached for it. */
	exists(workspaceId: number): boolean;
}

export interface SetupEntry {
	/** The stored setup with the unsaved change applied. */
	setup: StudySetup;
	/** The stored row as last read or written. */
	raw: unknown;
	/** True once the server answered in this session. */
	loaded: boolean;
	/** True once anything is known: the server answered, or the device holds a cached row. */
	known: boolean;
	/** Why the last write failed (the change is kept when it may pass, dropped on a refusal). */
	saveError: unknown | null;
}

interface Cached {
	raw: unknown;
	/** The change not saved yet; null when none. */
	pending: SetupPatch | null;
}

/** cleanPatch keeps the members of a stored patch that read back as themselves (a cache is untrusted). */
function cleanPatch(raw: unknown): SetupPatch | null {
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (key === 'version' || !(key in parseSetup(null))) continue;
		const read = (parseSetup({ [key]: value }) as unknown as Record<string, unknown>)[key];
		if (JSON.stringify(read) === JSON.stringify(value)) out[key] = value;
	}
	return out as SetupPatch;
}

/** Whether a failed write may pass later: no answer (offline), a timeout, a busy server or a server error. */
function retryable(err: unknown): boolean {
	const status = (err as { status?: unknown } | null)?.status;
	if (typeof status !== 'number') return true;
	return status === 408 || status === 429 || status >= 500;
}

export class StudySetups {
	readonly #deps: StudySetupsDeps;
	#entries = $state.raw<Record<number, SetupEntry>>({});
	// Plain bookkeeping (not shown): the unsaved patch, the writes begun and the write queue, per workspace.
	readonly #pending = new Map<number, SetupPatch>();
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
		const pending = cached?.pending ?? null;
		return {
			setup: { ...parseSetup(cached?.raw ?? null), ...(pending ?? {}) },
			raw: cached?.raw ?? null,
			loaded: false,
			known: cached !== null,
			saveError: pending !== null ? 'unsaved' : null
		};
	}

	/** refresh reads the row from the server; an unsaved change of this device is written over it. */
	async refresh(workspaceId: number): Promise<void> {
		if (!this.#deps.alive()) return;
		// Untracked: callers refresh from an effect, which must not depend on what the refresh writes.
		const pending = this.#pendingOf(workspaceId);
		if (pending !== null) return this.update(workspaceId, {});
		const epoch = this.#writes.get(workspaceId) ?? 0;
		try {
			const raw = await this.#deps.load(workspaceId);
			if (!this.#deps.alive() || epoch !== (this.#writes.get(workspaceId) ?? 0)) return;
			this.#set(workspaceId, { setup: parseSetup(raw), raw, loaded: true, known: true, saveError: null });
			this.#writeCache(workspaceId, { raw, pending: null });
		} catch {
			// Offline or a failed read: keep what is shown.
		}
	}

	/** update shows `patch` at once and writes it over the row read again, after the workspace's earlier writes. */
	update(workspaceId: number, patch: SetupPatch): Promise<void> {
		if (!this.#deps.alive()) return Promise.resolve();
		const mine = (this.#writes.get(workspaceId) ?? 0) + 1;
		this.#writes.set(workspaceId, mine);
		const merged = { ...(this.#pendingOf(workspaceId) ?? {}), ...patch };
		this.#pending.set(workspaceId, merged);
		const before = untrack(() => this.of(workspaceId));
		this.#set(workspaceId, { ...before, setup: { ...before.setup, ...patch }, saveError: null });
		this.#writeCache(workspaceId, { raw: before.raw, pending: merged });
		const run = async (): Promise<void> => {
			const sending = this.#pending.get(workspaceId);
			if (!this.#deps.alive() || sending === undefined) return;
			let fresh: unknown = undefined;
			try {
				fresh = await this.#deps.load(workspaceId);
				const data = withSetup(fresh, { ...parseSetup(fresh), ...sending });
				await this.#deps.save(workspaceId, data);
				if (!this.#deps.alive()) return;
				// A change made while this one was on its way stays pending for its own write.
				const left = this.#pending.get(workspaceId);
				const rest = left === sending ? null : (left ?? null);
				if (rest === null) this.#pending.delete(workspaceId);
				this.#set(workspaceId, { setup: { ...parseSetup(data), ...(rest ?? {}) }, raw: data, loaded: true, known: true, saveError: null });
				this.#writeCache(workspaceId, { raw: data, pending: rest });
			} catch (err) {
				if (!this.#deps.alive()) return;
				const shown = untrack(() => this.of(workspaceId));
				if (retryable(err)) {
					if (mine === this.#writes.get(workspaceId)) this.#set(workspaceId, { ...shown, saveError: err ?? 'failed' });
					return;
				}
				// Refused: the change can never be written; drop it and show the stored setup again
				// (the row just read, when the read got that far).
				const raw = fresh === undefined ? shown.raw : fresh;
				this.#pending.delete(workspaceId);
				this.#set(workspaceId, { ...shown, setup: parseSetup(raw), raw, loaded: shown.loaded || fresh !== undefined, saveError: err });
				this.#writeCache(workspaceId, { raw, pending: null });
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

	/** The unsaved patch: this session's, else the device cache's (a reload). */
	#pendingOf(workspaceId: number): SetupPatch | null {
		const inMemory = this.#pending.get(workspaceId);
		if (inMemory !== undefined) return inMemory;
		const cached = this.#readCache(workspaceId)?.pending ?? null;
		if (cached !== null) this.#pending.set(workspaceId, cached);
		return cached;
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
			const parsed = JSON.parse(text) as Partial<Cached> | null;
			if (typeof parsed !== 'object' || parsed === null) return null;
			return { raw: parsed.raw ?? null, pending: cleanPatch(parsed.pending) };
		} catch {
			return null;
		}
	}

	#writeCache(workspaceId: number, value: Cached): void {
		const user = this.#deps.user();
		if (user === null || !this.#deps.exists(workspaceId)) return;
		try {
			this.#deps.local()?.setItem(setupCacheKey(user, workspaceId), JSON.stringify(value));
		} catch {
			// A full or blocked storage only costs the instant paint after a reload.
		}
	}
}
