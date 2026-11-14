// User-global plugin data: rows stored for the signed-in user with no
// workspace (`workspace_id` NULL), through the generic plugin data
// routes without `?workspace=`. Workspace-scoped plugin data (decks and
// cards) lives in lib/study/store.ts and must never use these helpers.

import { ApiError, api } from './client';

function dataPath(pluginId: string, key: string): string {
	return `/api/plugins/${encodeURIComponent(pluginId)}/data/${encodeURIComponent(key)}`;
}

/**
 * decodeData unwraps a stored value. The API serves it as JSON, but a
 * row may carry it as a string (an older writer, a fixture); an
 * unparsable string is treated as absent.
 */
function decodeData(data: unknown): unknown {
	if (typeof data !== 'string') return data;
	try {
		return JSON.parse(data) as unknown;
	} catch {
		return null;
	}
}

/**
 * getUserPluginData reads the caller's user-global value for one key of
 * one plugin; a missing (or deleted) row is null. Other failures throw.
 */
export async function getUserPluginData(pluginId: string, key: string): Promise<unknown | null> {
	try {
		const row = await api<{ data?: unknown } | undefined>(dataPath(pluginId, key), {
			method: 'GET'
		});
		return row === undefined || row === null ? null : (decodeData(row.data) ?? null);
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return null;
		throw err;
	}
}

/** putUserPluginData stores the caller's user-global value for one key (last write wins). */
export async function putUserPluginData(
	pluginId: string,
	key: string,
	value: unknown
): Promise<void> {
	await api<unknown>(dataPath(pluginId, key), { method: 'PUT', body: value });
}
