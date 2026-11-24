// The user's workspaces (record 0009): everything the user may switch between
// plus the one in use, a runes class owned by the session. The static SPA has
// no server session, so the chosen workspace is remembered across reloads in
// localStorage (WORKSPACE_KEY); only an explicit sign-out forgets it (workspace
// ids are global: the next user must not inherit it).

import { ApiError } from './api/client';
import type { Workspace } from './api/types';
import type { Api } from './context/deps';
import { forgetWorkspace } from './workspaceDelete';

export const WORKSPACE_KEY = 'qinqin.workspace';

export interface WorkspacesState {
	list: Workspace[];
	current: Workspace | null;
}

export interface WorkspacesDeps {
	api: Api;
	local(): Storage | null;
	session(): Storage | null;
	/** False once the session ended: a late answer then changes nothing outside this object. */
	alive(): boolean;
}

export class Workspaces {
	readonly #deps: WorkspacesDeps;
	#state = $state.raw<WorkspacesState>({ list: [], current: null });
	#loaded = $state(false);
	#loadError = $state('');
	// Counts load() calls so only the most recently started one applies.
	#loadSeq = 0;

	constructor(deps: WorkspacesDeps) {
		this.#deps = deps;
	}

	get list(): Workspace[] {
		return this.#state.list;
	}

	get current(): Workspace | null {
		return this.#state.current;
	}

	/** The current workspace's language, or null. */
	get language(): string | null {
		return this.#state.current?.language ?? null;
	}

	/** True once a list arrived, so pages can tell "still loading" from "really none". */
	get loaded(): boolean {
		return this.#loaded;
	}

	/** The message of the last failed list load (the shell shows Try again), '' when none. */
	get loadError(): string {
		return this.#loadError;
	}

	set loadError(message: string) {
		this.#loadError = message;
	}

	/** set replaces the list and the selection (`loaded`: whether a list arrived; unchanged when omitted). */
	set(state: WorkspacesState, loaded?: boolean): void {
		this.#state = state;
		if (loaded !== undefined) this.#loaded = loaded;
	}

	/**
	 * load fetches the caller's workspaces. The persisted selection wins when it
	 * still exists, otherwise the first workspace is selected; an empty list
	 * clears the selection. Either way the selection on disk is brought back in
	 * sync. A newer load started since (create() reloading while the shell's
	 * first load was in flight) wins: this answer then changes nothing.
	 */
	async load(): Promise<Workspace[]> {
		const seq = ++this.#loadSeq;
		const list = await this.#deps.api<Workspace[]>('/api/workspaces');
		if (seq !== this.#loadSeq || !this.#deps.alive()) return list;
		const persisted = this.#readSelection();
		const current = list.find((workspace) => workspace.id === persisted) ?? list[0] ?? null;
		this.#persistSelection(current?.id ?? null);
		this.#state = { list, current };
		this.#loaded = true;
		this.#loadError = '';
		return list;
	}

	/**
	 * create opens a workspace for `language` (the API lowercases and
	 * auto-registers data-only codes) with an optional display name, reloads the
	 * list, and selects it. A blank name is not sent; the API answers 409 when
	 * the (language, name) pair already exists.
	 */
	async create(language: string, name?: string): Promise<Workspace> {
		const trimmed = name?.trim() ?? '';
		const created = await this.#deps.api<Workspace>('/api/workspaces', {
			method: 'POST',
			body: trimmed ? { language, name: trimmed } : { language }
		});
		await this.load();
		this.select(created.id);
		return created;
	}

	/** rename sets a workspace's display name ('' clears it) and holds the server's copy. */
	async rename(id: number, name: string): Promise<Workspace> {
		return this.#replace(await this.#deps.api<Workspace>(`/api/workspaces/${id}`, { method: 'PUT', body: { name: name.trim() } }));
	}

	/** setSettings merges a settings patch into a workspace (PUT merges server-side) and holds the server's copy. */
	async setSettings(id: number, patch: Record<string, unknown>): Promise<Workspace> {
		return this.#replace(await this.#deps.api<Workspace>(`/api/workspaces/${id}`, { method: 'PUT', body: { settings: patch } }));
	}

	/** select switches the current workspace and persists the choice. */
	select(id: number): void {
		const current = this.#state.list.find((workspace) => workspace.id === id) ?? null;
		if (current) this.#persistSelection(current.id);
		this.#state = { ...this.#state, current };
	}

	/**
	 * delete deletes a workspace and everything in it on the server, drops it
	 * from the list (the selection falls back to the first workspace left when
	 * it was the current one) and forgets what this browser kept for it. A
	 * workspace already gone (404, deleted from another device) counts as
	 * deleted and the list is reloaded; any other refusal, such as the 409 for
	 * the last workspace, is thrown and changes nothing.
	 */
	async delete(id: number): Promise<void> {
		let gone = false;
		try {
			await this.#deps.api<void>(`/api/workspaces/${id}`, { method: 'DELETE' });
		} catch (err) {
			if (!(err instanceof ApiError && err.status === 404)) throw err;
			gone = true;
		}
		forgetWorkspace(id, this.#deps.local(), this.#deps.session());
		if (gone) {
			await this.load();
			return;
		}
		const { list: all, current: was } = this.#state;
		const list = all.filter((workspace) => workspace.id !== id);
		const current = was?.id === id ? (list[0] ?? null) : was;
		if (was?.id === id) this.#persistSelection(current?.id ?? null);
		this.#state = { list, current };
	}

	/** dispose: the session ended; a sign-out also forgets the device's choice. */
	dispose(reason: 'signOut' | 'expired' | 'switched'): void {
		this.#loadSeq++;
		if (reason === 'signOut') this.#persistSelection(null);
	}

	#replace(updated: Workspace): Workspace {
		const { list, current } = this.#state;
		this.#state = {
			list: list.map((workspace) => (workspace.id === updated.id ? updated : workspace)),
			current: current?.id === updated.id ? updated : current
		};
		return updated;
	}

	#readSelection(): number | null {
		try {
			const raw = this.#deps.local()?.getItem(WORKSPACE_KEY) ?? null;
			if (raw === null) return null;
			const id = Number(raw);
			return Number.isInteger(id) ? id : null;
		} catch {
			return null;
		}
	}

	#persistSelection(id: number | null): void {
		try {
			const storage = this.#deps.local();
			if (id === null) storage?.removeItem(WORKSPACE_KEY);
			else storage?.setItem(WORKSPACE_KEY, String(id));
		} catch {
			// Storage unavailable (private mode): the selection lasts this session.
		}
	}
}
