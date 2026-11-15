// Lesson progress as workspace-scoped plugin data of `qinqin-grammar`.
// Reads come from one sync pull (like study/store.ts); a write is one PUT.

import { api } from '$lib/api/client';
import type { Progress } from './types';

export const GRAMMAR_PLUGIN_ID = 'qinqin-grammar';

const PREFIX = 'lesson:';
const SYNC_PULL_PATH =
	'/api/sync/pull?cursor=1970-01-01T00:00:00Z&collections=pluginData,pluginStates';

export function progressKey(packId: string, lessonId: string): string {
	return `${PREFIX}${packId}:${lessonId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseProgress(raw: unknown): Progress | null {
	if (!isRecord(raw)) return null;
	const { completedAt, best, total } = raw;
	if (typeof completedAt !== 'string') return null;
	if (!Number.isInteger(best) || !Number.isInteger(total)) return null;
	const b = best as number;
	const t = total as number;
	if (b < 0 || t < 0 || b > t) return null;
	return { completedAt, best: b, total: t };
}

function decode(data: unknown): unknown {
	if (typeof data !== 'string') return data;
	try {
		return JSON.parse(data) as unknown;
	} catch {
		return null;
	}
}

/** loadProgress reads the workspace's live lesson rows; malformed ones are skipped. */
export async function loadProgress(workspaceId: number): Promise<Map<string, Progress>> {
	const delta = await api<{ pluginData?: unknown }>(SYNC_PULL_PATH);
	const rows = Array.isArray(delta?.pluginData) ? delta.pluginData : [];
	const out = new Map<string, Progress>();
	for (const row of rows) {
		if (!isRecord(row)) continue;
		if (row.pluginId !== GRAMMAR_PLUGIN_ID || row.workspaceId !== workspaceId) continue;
		if (row.deletedAt != null) continue;
		if (typeof row.key !== 'string' || !row.key.startsWith(PREFIX)) continue;
		const progress = parseProgress(decode(row.data));
		if (progress !== null) out.set(row.key, progress);
	}
	return out;
}

/** saveProgress stores a finished run, keeping the best score ever reached. */
export async function saveProgress(
	workspaceId: number,
	packId: string,
	lessonId: string,
	score: number,
	total: number,
	previous: Progress | null
): Promise<Progress> {
	const next: Progress = {
		completedAt: new Date().toISOString(),
		best: Math.max(score, previous?.best ?? 0),
		total
	};
	const key = progressKey(packId, lessonId);
	await api(`/api/plugins/${GRAMMAR_PLUGIN_ID}/data/${key}?workspace=${workspaceId}`, {
		method: 'PUT',
		body: next
	});
	return next;
}
