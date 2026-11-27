// Helpers for deleting a workspace: the label the user types to confirm,
// and the browser-side cleanup of what this device kept for it. The
// server deletes the workspace's data; these are only conveniences, so
// every storage access is best-effort and never throws.

import type { Workspace } from '$lib/api/types';
import { workspaceDisplay } from '$lib/languages';
import { setupCacheWorkspace } from '$lib/features/flashcards/setup/setupStore.svelte';
import { PENDING_REVIEWS_KEY } from '$lib/studycore/events';

/**
 * confirmLabel is what the user types to confirm deleting `ws`: the name
 * the switcher shows for it ("Work", "Japanese 2"), or its language
 * label when it is the only unnamed workspace of its language.
 */
export function confirmLabel(list: readonly Workspace[], ws: Workspace): string {
	const display = workspaceDisplay(list, ws);
	return display.showName ? display.name : display.label;
}

/** labelMatches: the typed text is the label, ignoring surrounding spaces. */
export function labelMatches(typed: string, label: string): boolean {
	return typed.trim() === label;
}

/** The per-day session receipts of recordSessionOnce (lib/events/index.ts). */
function sessionReceiptPrefix(id: number): string {
	return `qinqin.session.${id}.`;
}

function attempt(fn: () => void): void {
	try {
		fn();
	} catch {
		// Storage denied or a corrupt value: leave it as it is.
	}
}

/**
 * Removes the queued reviews of `id` from the review outbox: the
 * `{userId, queuedAt, event}` items of every user (a workspace id is global
 * and the workspace is gone for all).
 */
function dropPending(storage: Storage, id: number): void {
	attempt(() => {
		const raw = storage.getItem(PENDING_REVIEWS_KEY);
		if (raw === null) return;
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return;
		const inWorkspace = (item: unknown): boolean => {
			const event = (item as { event?: unknown } | null)?.event;
			return typeof event === 'object' && event !== null && (event as { workspaceId?: unknown }).workspaceId === id;
		};
		const kept = parsed.filter((item) => !inWorkspace(item));
		if (kept.length === parsed.length) return;
		if (kept.length === 0) storage.removeItem(PENDING_REVIEWS_KEY);
		else storage.setItem(PENDING_REVIEWS_KEY, JSON.stringify(kept));
	});
}

/**
 * forgetWorkspace removes what this browser keeps for a deleted
 * workspace: its daily session receipts, its cached study setups (every
 * user's: a workspace id is global) and queued reviews (localStorage). Other
 * workspaces' entries and global preferences stay. The selection key is the
 * store's business.
 */
export function forgetWorkspace(id: number, local: Storage | null): void {
	if (local !== null) {
		attempt(() => {
			const prefix = sessionReceiptPrefix(id);
			const doomed: string[] = [];
			for (let i = 0; i < local.length; i++) {
				const key = local.key(i);
				if (key !== null && (key.startsWith(prefix) || setupCacheWorkspace(key) === id)) doomed.push(key);
			}
			for (const key of doomed) local.removeItem(key);
		});
		dropPending(local, id);
	}
}
