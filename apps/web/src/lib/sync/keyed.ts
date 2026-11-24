// Keyed plugin-data rows (#193): one path for every namespace — the study
// namespace's keyed rows (goals, known marks, vacations, milestones), the
// core rows (notes, lookups, layout, widget options, theme, navigation
// layout) and, until #199 retires it, the plugin SDK's data scope. Route
// building, the one data decode, the decode of a listed or pulled row and the
// last-write-wins batch push live here; nothing else spells the routes.
//
// Reading rows follows docs/contracts/sync/ "Reading rows" (record 0002): a
// row off the contract shape is unreadable and skipped by the reader, never
// the whole answer; a study reader that must protect it checks the shape
// itself (readableRow) before it decodes.

import { ApiError, api } from '../api/client';
import { readableRow } from './rows';
import { pushChunks, stampOf, type ChunkOptions } from './push';

/** The core namespace: notes, lookups, layout, widget options, theme, navigation layout, activity view. */
export const CORE_NAMESPACE = 'qinqin-core';
/** The study namespace: its keyed rows (goals, known marks, vacations, milestones); typed rows are no plugin data. */
export const STUDY_NAMESPACE = 'qinqin-flashcards';

/** A keyed row as the list route and the pull send it, its data decoded. */
export interface KeyedRow<T = unknown> {
	pluginId: string;
	key: string;
	workspaceId: number | null;
	data: T;
	version: number;
	updatedAt: string;
	deletedAt: string | null;
}

/**
 * decodeKeyedData: the API serves data as JSON, but a row may carry JSON text as
 * a string (an older writer). JSON text is decoded; any other string is kept as
 * it is, so put('k', 'hello') reads back as 'hello'. A string that is itself
 * valid JSON text ('123', '{"a":1}') still reads back decoded: store objects.
 */
export function decodeKeyedData(data: unknown): unknown {
	if (typeof data !== 'string') return data;
	try {
		return JSON.parse(data) as unknown;
	} catch {
		return data;
	}
}

/** keyedRowOf decodes one row of the list route or of a pull, or null when it is off the contract shape. */
export function keyedRowOf(raw: unknown): KeyedRow | null {
	if (!readableRow('pluginData', raw)) return null;
	const row = raw as Record<string, unknown>;
	const workspaceId = row.workspaceId;
	if (workspaceId !== null && !Number.isInteger(workspaceId)) return null;
	return {
		pluginId: row.pluginId as string,
		key: row.key as string,
		workspaceId: workspaceId as number | null,
		data: decodeKeyedData(row.data),
		version: row.version as number,
		updatedAt: row.updatedAt as string,
		deletedAt: row.deletedAt as string | null
	};
}

function base(namespace: string): string {
	return `/api/plugins/${encodeURIComponent(namespace)}/data`;
}

/** keyedPath: the key route of one row; `workspace` null is the user-global row. */
export function keyedPath(namespace: string, key: string, workspace: number | null): string {
	// '.' and '..' would be resolved away as path segments, and an empty key is no route.
	if (key === '' || key === '.' || key === '..') {
		throw new Error(`${namespace}: invalid data key "${key}"`);
	}
	// ':' is legal in a path segment, so keys like `entry:<id>` keep their readable form.
	const path = `${base(namespace)}/${encodeURIComponent(key).replaceAll('%3A', ':')}`;
	return workspace === null ? path : `${path}?workspace=${workspace}`;
}

export interface KeyedScope {
	/** 404 or a deleted row is null; the data decoded. */
	get<T = unknown>(key: string): Promise<T | null>;
	/** Stores the value (a tombstone revives); answers the stored row, or null when the answer is not one. */
	put(key: string, value: unknown, opts?: { keepalive?: boolean }): Promise<KeyedRow | null>;
	/** Reads one key through the prefix route (a missing row is an empty 200, not a logged 404). */
	find<T = unknown>(key: string): Promise<T | null>;
	/** The live rows whose key starts with `prefix`, ordered by key; unreadable rows skipped. */
	list<T = unknown>(prefix?: string): Promise<KeyedRow<T>[]>;
	/** Tombstones the row; a missing row counts as deleted. */
	delete(key: string): Promise<void>;
}

/** keyedData: the key routes of one namespace, scoped to a workspace or (null) user-global. */
export function keyedData(namespace: string, workspace: number | null): KeyedScope {
	const scope: KeyedScope = {
		async get<T>(key: string): Promise<T | null> {
			const path = keyedPath(namespace, key, workspace);
			try {
				const row = await api<{ data?: unknown } | undefined>(path, { method: 'GET' });
				return row === undefined || row === null ? null : ((decodeKeyedData(row.data) ?? null) as T | null);
			} catch (err) {
				if (err instanceof ApiError && err.status === 404) return null;
				throw err;
			}
		},
		async put(key, value, opts) {
			const path = keyedPath(namespace, key, workspace);
			const answer = await api<unknown>(path, {
				method: 'PUT',
				body: value,
				...(opts?.keepalive ? { keepalive: true } : {})
			});
			return keyedRowOf(answer);
		},
		async find<T>(key: string): Promise<T | null> {
			const rows = await scope.list<T>(key);
			const row = rows.find((r) => r.key === key);
			return row === undefined ? null : ((row.data ?? null) as T | null);
		},
		async list<T>(prefix?: string): Promise<KeyedRow<T>[]> {
			const query: string[] = [];
			if (workspace !== null) query.push(`workspace=${workspace}`);
			if (prefix !== undefined) query.push(`prefix=${encodeURIComponent(prefix)}`);
			const rows = await api<unknown[] | undefined>(`${base(namespace)}${query.length ? `?${query.join('&')}` : ''}`);
			const out: KeyedRow<T>[] = [];
			let skipped = 0;
			for (const raw of Array.isArray(rows) ? rows : []) {
				const row = keyedRowOf(raw);
				if (row === null) skipped++;
				else out.push(row as KeyedRow<T>);
			}
			if (skipped > 0) console.warn(`${namespace}: skipped ${skipped} unreadable data row(s)`);
			return out;
		},
		async delete(key) {
			const path = keyedPath(namespace, key, workspace);
			try {
				await api(path, { method: 'DELETE' });
			} catch (err) {
				// Only a missing row is done already; a missing workspace (workspace_not_found) is an error.
				if (err instanceof ApiError && err.status === 404 && err.code === 'not_found') return;
				throw err;
			}
		}
	};
	return scope;
}

/** One keyed row to push: its data, the newest time the server holds for it, and whether it is a tombstone. */
export interface KeyedWrite {
	key: string;
	data: unknown;
	knownAt?: string;
	deleted?: true;
}

/**
 * pushKeyed writes keyed rows through POST /api/sync/push in chunks, each stamped
 * after the time the server holds for its key (stampOf). Answers the stamp each
 * row was sent with; a skipped row is a PartialPushError (pushChunks).
 */
export async function pushKeyed(
	namespace: string,
	workspace: number | null,
	rows: readonly KeyedWrite[],
	opts: ChunkOptions = {},
	/** Filled with each row's stamp as its chunk is built (readable in `opts.after`). */
	stamps: string[] = []
): Promise<string[]> {
	await pushChunks(rows.length, opts, (from, to, nowMs) => ({
		pluginData: rows.slice(from, to).map((row, i) => {
			const stamp = stampOf(nowMs, row.knownAt);
			stamps[from + i] = stamp;
			return {
				pluginId: namespace,
				key: row.key,
				workspaceId: workspace,
				data: row.data,
				updatedAt: stamp,
				...(row.deleted ? { deletedAt: stamp } : {})
			};
		})
	}));
	return stamps;
}
