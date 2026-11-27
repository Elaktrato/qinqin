// A workspace deleted in another tab or on another device: this tab still
// has it selected, and every workspace-scoped call answers 404
// `workspace_not_found`. The first such answer (the app context routes it
// here) reloads the workspace list; when the selected workspace is gone the
// list falls back to the first one left (Workspaces.load does that) and the
// shell shows a one-line notice. Reloads are shared and spaced out, so a burst
// of stale 404s (pages, widgets, the review outbox) cannot loop. One per
// session (record 0009).

import { ApiError, isWorkspaceGoneResponse } from '$lib/api/client';
import { t } from '$lib/i18n';
import type { Notices } from '$lib/frame/notices.svelte';
import { confirmLabel, forgetWorkspace } from './workspaceDelete';
import type { Workspaces } from './workspaces.svelte';

/** No second reload within this long after one finished. */
export const RECOVERY_COOLDOWN_MS = 10_000;

/** isWorkspaceGone: the API answered 404 `workspace_not_found`. */
export function isWorkspaceGone(err: unknown): boolean {
	return err instanceof ApiError && isWorkspaceGoneResponse(err.status, err.code);
}

export interface WorkspaceRecoveryDeps {
	workspaces: Workspaces;
	notices: Notices;
	now(): number;
	local(): Storage | null;
	session(): Storage | null;
	/** Removes the queued reviews of a deleted workspace from the outbox (IndexedDB). */
	dropReviews?(workspaceId: number): void;
}

export class WorkspaceRecovery {
	readonly #deps: WorkspaceRecoveryDeps;
	#inFlight: Promise<void> | null = null;
	#lastReload = Number.NEGATIVE_INFINITY;

	constructor(deps: WorkspaceRecoveryDeps) {
		this.#deps = deps;
	}

	/**
	 * recover reloads the workspace list after a workspace_not_found.
	 * Concurrent calls share one reload, and calls within the cooldown after
	 * one do nothing. Never throws.
	 */
	recover(): Promise<void> {
		if (this.#inFlight !== null) return this.#inFlight;
		if (this.#deps.now() - this.#lastReload < RECOVERY_COOLDOWN_MS) return Promise.resolve();
		this.#inFlight = this.#reload().finally(() => {
			this.#inFlight = null;
		});
		return this.#inFlight;
	}

	async #reload(): Promise<void> {
		const { workspaces, notices } = this.#deps;
		const before = workspaces.current;
		try {
			await workspaces.load();
		} catch {
			// Offline or signed out: the next workspace_not_found retries.
			return;
		} finally {
			this.#lastReload = this.#deps.now();
		}
		if (before === null) return;
		const { list, current } = workspaces;
		if (list.some((workspace) => workspace.id === before.id)) return;
		forgetWorkspace(before.id, this.#deps.local());
		this.#deps.dropReviews?.(before.id);
		notices.show(
			current
				? t('app.workspaces.deletedSwitched', { workspace: confirmLabel(list, current) })
				: t('app.workspaces.deleted')
		);
	}
}
