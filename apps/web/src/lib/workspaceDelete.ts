// Helpers for deleting a workspace: the label the user types to confirm,
// and the browser-side cleanup of what this device kept for it. The
// server deletes the workspace's data; these are only conveniences, so
// every storage access is best-effort and never throws.

import type { Workspace } from './api/types';
import { workspaceDisplay } from './languages';
import { LAST_CARD_TYPES_KEY } from './study/cardTypesMemory';
import { PENDING_REVIEWS_KEY } from './study/events';
import { INELIGIBLE_KEY } from './study/ineligible';

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

/** The per-day session receipts of recordSessionOnce (lib/events.ts). */
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

/** Removes `id`'s entry from a JSON object keyed by workspace id. */
function dropEntry(storage: Storage, key: string, id: number): void {
	const raw = storage.getItem(key);
	if (raw === null) return;
	const parsed: unknown = JSON.parse(raw);
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
	const all = parsed as Record<string, unknown>;
	if (!(String(id) in all)) return;
	delete all[String(id)];
	if (Object.keys(all).length === 0) storage.removeItem(key);
	else storage.setItem(key, JSON.stringify(all));
}

/** Removes the queued reviews of `id` from the review outbox. */
function dropPending(storage: Storage, id: number): void {
	const raw = storage.getItem(PENDING_REVIEWS_KEY);
	if (raw === null) return;
	const parsed: unknown = JSON.parse(raw);
	if (!Array.isArray(parsed)) return;
	const kept = parsed.filter(
		(event) => !(typeof event === 'object' && event !== null && (event as { workspaceId?: unknown }).workspaceId === id)
	);
	if (kept.length === parsed.length) return;
	if (kept.length === 0) storage.removeItem(PENDING_REVIEWS_KEY);
	else storage.setItem(PENDING_REVIEWS_KEY, JSON.stringify(kept));
}

/**
 * forgetWorkspace removes what this browser keeps for a deleted
 * workspace: its daily session receipts, its remembered card types and
 * queued reviews (localStorage), and this tab's ineligible-companion
 * memory (sessionStorage). Other workspaces' entries and global
 * preferences stay. The selection key is the store's business.
 */
export function forgetWorkspace(id: number, local: Storage | null, session: Storage | null): void {
	if (local !== null) {
		attempt(() => {
			const prefix = sessionReceiptPrefix(id);
			const doomed: string[] = [];
			for (let i = 0; i < local.length; i++) {
				const key = local.key(i);
				if (key !== null && key.startsWith(prefix)) doomed.push(key);
			}
			for (const key of doomed) local.removeItem(key);
		});
		attempt(() => dropEntry(local, LAST_CARD_TYPES_KEY, id));
		attempt(() => dropPending(local, id));
	}
	if (session !== null) {
		attempt(() => dropEntry(session, INELIGIBLE_KEY, id));
	}
}
