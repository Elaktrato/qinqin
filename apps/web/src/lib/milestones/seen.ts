// The seen state of milestones: one qinqin-flashcards row `milestone:<id>`
// per seen milestone (workspace row). Seen is decided by the key alone; a
// row is written only when its key is not live, never rewritten, never
// deleted. Offline dismisses wait in a per-user, per-workspace pending list
// in localStorage. Pure except the pending list.
// Rule and fixtures: docs/contracts/milestones/ (seen-rows.json, seen-merge.json).

import { isDay } from '$lib/time/studyDay';
import { MILESTONE_KEY_PREFIX } from './catalogue';
import type { Reached } from './reached';

export interface SeenMilestone {
	id: string;
	/** When it was marked seen (RFC 3339), null when the row has none. */
	seenAt: string | null;
	/** The reached day stored with the row, null when absent or invalid. */
	reachedDay: string | null;
}

function member(data: unknown, name: string): unknown {
	return typeof data === 'object' && data !== null && !Array.isArray(data)
		? (data as Record<string, unknown>)[name]
		: undefined;
}

function seenOf(id: string, data: unknown): SeenMilestone {
	const seenAt = member(data, 'seenAt');
	const reachedDay = member(data, 'reachedDay');
	return {
		id,
		seenAt: typeof seenAt === 'string' && seenAt !== '' ? seenAt : null,
		reachedDay: isDay(reachedDay) ? reachedDay : null
	};
}

/**
 * parseSeenRows: the live `milestone:` rows, by id (the key minus the
 * prefix, whatever the data says), in row order. Tombstones are not seen.
 * Ids this client does not know are kept: they still count as seen.
 */
export function parseSeenRows(
	rows: readonly { key: string; data: unknown; deletedAt: string | null }[]
): Map<string, SeenMilestone> {
	const out = new Map<string, SeenMilestone>();
	for (const row of rows) {
		if (!row.key.startsWith(MILESTONE_KEY_PREFIX)) continue;
		const id = row.key.slice(MILESTONE_KEY_PREFIX.length);
		if (id === '' || row.deletedAt != null) continue;
		out.set(id, seenOf(id, row.data));
	}
	return out;
}

/** seenRow: the row a dismiss writes for one milestone. */
export function seenRow(
	m: Reached,
	seenAt: Date
): { key: string; data: { version: 1; id: string; seenAt: string; reachedDay: string } } {
	return {
		key: `${MILESTONE_KEY_PREFIX}${m.id}`,
		data: { version: 1, id: m.id, seenAt: seenAt.toISOString(), reachedDay: m.day }
	};
}

/** seenWritePlan: the rows to push — only ids with no live row, each once; never a tombstone. */
export function seenWritePlan(
	mark: readonly Reached[],
	live: ReadonlyMap<string, SeenMilestone>,
	now: Date
): { key: string; data: unknown }[] {
	const out: { key: string; data: unknown }[] = [];
	const planned = new Set<string>();
	for (const m of mark) {
		if (live.has(m.id) || planned.has(m.id)) continue;
		planned.add(m.id);
		out.push(seenRow(m, now));
	}
	return out;
}

/** seenIds: live rows ∪ the pending list. */
export function seenIds(live: ReadonlyMap<string, SeenMilestone>, pending: readonly SeenMilestone[]): Set<string> {
	const out = new Set(live.keys());
	for (const m of pending) out.add(m.id);
	return out;
}

/** The pending list's storage key: per user and workspace. */
export function pendingKey(userId: number, workspaceId: number): string {
	return `qinqin:milestones-pending:${userId}:${workspaceId}`;
}

function storage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' || localStorage === null ? null : localStorage;
	} catch {
		return null;
	}
}

/** readPending: the ids dismissed here and not yet live; [] on any storage error. */
export function readPending(userId: number, workspaceId: number): SeenMilestone[] {
	try {
		const raw = storage()?.getItem(pendingKey(userId, workspaceId));
		if (raw == null) return [];
		const list: unknown = JSON.parse(raw);
		if (!Array.isArray(list)) return [];
		const out: SeenMilestone[] = [];
		const ids = new Set<string>();
		for (const item of list) {
			const id = member(item, 'id');
			if (typeof id !== 'string' || id === '' || ids.has(id)) continue;
			ids.add(id);
			out.push(seenOf(id, item));
		}
		return out;
	} catch {
		return [];
	}
}

function writePending(userId: number, workspaceId: number, list: readonly SeenMilestone[]): void {
	try {
		const store = storage();
		if (store === null) return;
		if (list.length === 0) store.removeItem(pendingKey(userId, workspaceId));
		else store.setItem(pendingKey(userId, workspaceId), JSON.stringify(list));
	} catch {
		// Storage unavailable (private window): the dismiss is forgotten on reload.
	}
}

/** addPending: adds ids not pending yet (the first entry of an id stays). */
export function addPending(userId: number, workspaceId: number, items: readonly SeenMilestone[]): void {
	const list = readPending(userId, workspaceId);
	const ids = new Set(list.map((m) => m.id));
	for (const item of items) {
		if (ids.has(item.id)) continue;
		ids.add(item.id);
		list.push(item);
	}
	writePending(userId, workspaceId, list);
}

/** dropPending: forgets ids (their rows were pushed). */
export function dropPending(userId: number, workspaceId: number, ids: readonly string[]): void {
	const gone = new Set(ids);
	const list = readPending(userId, workspaceId);
	const kept = list.filter((m) => !gone.has(m.id));
	if (kept.length !== list.length) writePending(userId, workspaceId, kept);
}

/** prunePending: an id leaves the list once its row is live in a pull. */
export function prunePending(userId: number, workspaceId: number, live: ReadonlyMap<string, SeenMilestone>): void {
	dropPending(
		userId,
		workspaceId,
		readPending(userId, workspaceId)
			.map((m) => m.id)
			.filter((id) => live.has(id))
	);
}
