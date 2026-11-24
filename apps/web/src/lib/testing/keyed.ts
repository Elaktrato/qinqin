// TEST-ONLY: a keyed plugin-data row as the list route and the pull send it
// (docs/contracts/sync/pull-page.json `shapes.pluginData`: every key present).
// lib/sync/keyed.ts skips a row off that shape, so tests build rows here.

export interface WireDataRow {
	pluginId: string;
	key: string;
	userId: number;
	workspaceId: number | null;
	data: unknown;
	version: number;
	updatedAt: string;
	deletedAt: string | null;
}

/** dataRow: a qinqin-core, user-global, live row unless the overrides say otherwise. */
export function dataRow(over: Partial<WireDataRow> & { key: string }): WireDataRow {
	return {
		pluginId: 'qinqin-core',
		userId: 1,
		workspaceId: null,
		data: null,
		version: 1,
		updatedAt: '2026-01-01T00:00:00Z',
		deletedAt: null,
		...over
	};
}
