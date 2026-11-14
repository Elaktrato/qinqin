import { derived, get, writable } from 'svelte/store';
import { ApiError, api } from './api/client';
import type { Workspace } from './api/types';
import { forgetWorkspace } from './workspaceDelete';

// The static SPA has no server session, so the chosen workspace is
// remembered across reloads in localStorage under this exact key.
export const WORKSPACE_KEY = 'qinqin.workspace';

export interface WorkspacesState {
	list: Workspace[];
	current: Workspace | null;
}

// The single source of truth for the user's workspaces: everything the
// user may switch between plus the one currently in use. Pages
// subscribe with `$workspaces`; the shell switcher mutates it through
// `select`.
export const workspaces = writable<WorkspacesState>({ list: [], current: null });

export const currentLanguage = derived(
	workspaces,
	($workspaces) => $workspaces.current?.language ?? null
);

function readSelection(): number | null {
	try {
		if (typeof localStorage === 'undefined') return null;
		const raw = localStorage.getItem(WORKSPACE_KEY);
		if (raw === null) return null;
		const id = Number(raw);
		return Number.isInteger(id) ? id : null;
	} catch {
		return null;
	}
}

function persistSelection(id: number | null): void {
	try {
		if (id === null) {
			localStorage.removeItem(WORKSPACE_KEY);
		} else {
			localStorage.setItem(WORKSPACE_KEY, String(id));
		}
	} catch {
		// Storage unavailable (private mode): selection lasts this session.
	}
}

/**
 * load fetches the caller's workspaces. The persisted selection wins
 * when it still exists, otherwise the first workspace is selected; an
 * empty list clears the selection. Either way the selection on disk is
 * brought back in sync.
 */
export async function load(): Promise<Workspace[]> {
	const list = await api<Workspace[]>('/api/workspaces');
	const persisted = readSelection();
	const current = list.find((workspace) => workspace.id === persisted) ?? list[0] ?? null;
	persistSelection(current?.id ?? null);
	workspaces.set({ list, current });
	return list;
}

/**
 * create opens a workspace for `language` (the API lowercases and
 * auto-registers data-only codes) with an optional display name,
 * reloads the list, and selects it. A blank name is not sent; the API
 * answers 409 when the (language, name) pair already exists.
 */
export async function create(language: string, name?: string): Promise<Workspace> {
	const trimmed = name?.trim() ?? '';
	const created = await api<Workspace>('/api/workspaces', {
		method: 'POST',
		body: trimmed ? { language, name: trimmed } : { language }
	});
	await load();
	select(created.id);
	return created;
}

/**
 * rename sets a workspace's display name ('' clears it) and replaces
 * that workspace in the store with the server's copy, keeping the
 * current selection.
 */
export async function rename(id: number, name: string): Promise<Workspace> {
	const updated = await api<Workspace>(`/api/workspaces/${id}`, {
		method: 'PUT',
		body: { name: name.trim() }
	});
	workspaces.update((state) => ({
		list: state.list.map((workspace) => (workspace.id === id ? updated : workspace)),
		current: state.current?.id === id ? updated : state.current
	}));
	return updated;
}

/** select switches the current workspace and persists the choice. */
export function select(id: number): void {
	const state = get(workspaces);
	const current = state.list.find((workspace) => workspace.id === id) ?? null;
	if (current) {
		persistSelection(current.id);
	}
	workspaces.set({ ...state, current });
}

function browserStorage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
	try {
		return typeof globalThis[kind] === 'undefined' ? null : globalThis[kind];
	} catch {
		return null;
	}
}

/**
 * deleteWorkspace deletes a workspace and everything in it on the
 * server, drops it from the store (the selection falls back to the first
 * workspace left when it was the current one) and forgets what this
 * browser kept for it. A workspace already gone (404, deleted from
 * another device) counts as deleted and the list is reloaded; any other
 * refusal, such as the 409 for the last workspace, is thrown and changes
 * nothing.
 */
export async function deleteWorkspace(id: number): Promise<void> {
	let gone = false;
	try {
		await api<void>(`/api/workspaces/${id}`, { method: 'DELETE' });
	} catch (err) {
		if (!(err instanceof ApiError && err.status === 404)) throw err;
		gone = true;
	}
	forgetWorkspace(id, browserStorage('localStorage'), browserStorage('sessionStorage'));
	if (gone) {
		await load();
		return;
	}
	const state = get(workspaces);
	const list = state.list.filter((workspace) => workspace.id !== id);
	const current = state.current?.id === id ? (list[0] ?? null) : state.current;
	if (state.current?.id === id) persistSelection(current?.id ?? null);
	workspaces.set({ list, current });
}
