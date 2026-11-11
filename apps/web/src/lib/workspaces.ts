import { derived, get, writable } from 'svelte/store';
import { api } from './api/client';
import type { Workspace } from './api/types';

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
 * auto-registers data-only codes), reloads the list, and selects it.
 */
export async function create(language: string): Promise<Workspace> {
	const created = await api<Workspace>('/api/workspaces', {
		method: 'POST',
		body: { language }
	});
	await load();
	select(created.id);
	return created;
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
