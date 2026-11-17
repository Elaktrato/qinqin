// A workspace deleted in another tab or on another device: this tab
// still has it selected, and every workspace-scoped call answers 404
// "workspace not found". The first such answer reloads the workspace
// list; when the selected workspace is gone the store falls back to the
// first one left (load() does that) and the shell shows a one-line
// notice. Reloads are shared and spaced out, so a burst of stale 404s
// (pages, widgets, the review outbox) cannot loop.

import { get } from 'svelte/store';
import { ApiError, isWorkspaceGoneResponse, setWorkspaceGoneHandler } from './api/client';
import { t } from './i18n';
import { showNotice } from './notices';
import { confirmLabel, forgetWorkspace } from './workspaceDelete';
import { load, workspaces } from './workspaces';

/** No second reload within this long after one finished. */
const COOLDOWN_MS = 10_000;

let inFlight: Promise<void> | null = null;
let lastReload = Number.NEGATIVE_INFINITY;

/** isWorkspaceGone: the API answered 404 "workspace not found". */
export function isWorkspaceGone(err: unknown): boolean {
	return err instanceof ApiError && isWorkspaceGoneResponse(err.status, err.message);
}

function storage(kind: 'localStorage' | 'sessionStorage'): Storage | null {
	try {
		return typeof globalThis[kind] === 'undefined' ? null : globalThis[kind];
	} catch {
		return null;
	}
}

async function reload(): Promise<void> {
	const before = get(workspaces).current;
	try {
		await load();
	} catch {
		// Offline or signed out: the next "workspace not found" retries.
		return;
	} finally {
		lastReload = Date.now();
	}
	if (before === null) return;
	const { list, current } = get(workspaces);
	if (list.some((workspace) => workspace.id === before.id)) return;
	forgetWorkspace(before.id, storage('localStorage'), storage('sessionStorage'));
	showNotice(
		current
			? t('app.workspaces.deletedSwitched', { workspace: confirmLabel(list, current) })
			: t('app.workspaces.deleted')
	);
}

/**
 * recoverFromDeletedWorkspace reloads the workspace list after a "workspace
 * not found". Concurrent calls share one reload, and calls within the
 * cooldown after one do nothing. Never throws.
 */
export function recoverFromDeletedWorkspace(): Promise<void> {
	if (inFlight !== null) return inFlight;
	if (Date.now() - lastReload < COOLDOWN_MS) return Promise.resolve();
	inFlight = reload().finally(() => {
		inFlight = null;
	});
	return inFlight;
}

/** watchDeletedWorkspaces hooks the recovery into every API call. */
export function watchDeletedWorkspaces(): void {
	setWorkspaceGoneHandler(() => {
		void recoverFromDeletedWorkspace();
	});
}
