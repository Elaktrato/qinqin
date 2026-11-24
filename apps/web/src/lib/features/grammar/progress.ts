// Lesson progress (docs/contracts/grammar/): the workspace's rows of
// GET /api/grammar/progress, and a finished run recorded with
// POST /api/grammar/progress. The server keeps the best score.

import { api } from '$lib/api/client';
import type { Progress } from './types';

/** progressKey: the map key of a lesson's progress. */
export function progressKey(packId: string, lessonId: string): string {
	return `${packId}:${lessonId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** parseProgress reads the progress members of a row; null unless every member holds. */
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

/** parseProgressRow reads one row of the list; null when it is not one. */
export function parseProgressRow(raw: unknown): { packId: string; lessonId: string; progress: Progress } | null {
	if (!isRecord(raw) || typeof raw.packId !== 'string' || raw.packId === '' || typeof raw.lessonId !== 'string' || raw.lessonId === '') return null;
	const progress = parseProgress(raw);
	return progress === null ? null : { packId: raw.packId, lessonId: raw.lessonId, progress };
}

/** loadProgress reads the workspace's lesson progress by progressKey; malformed rows are skipped. */
export async function loadProgress(workspaceId: number): Promise<Map<string, Progress>> {
	const rows = await api<unknown>(`/api/grammar/progress?workspace=${workspaceId}`);
	const out = new Map<string, Progress>();
	for (const raw of Array.isArray(rows) ? rows : []) {
		const row = parseProgressRow(raw);
		if (row !== null) out.set(progressKey(row.packId, row.lessonId), row.progress);
	}
	return out;
}

/**
 * recordRun stores a finished run and answers the stored progress: the
 * server keeps the best score of runs with the same number of exercises.
 * A failed request throws for the caller to show and retry.
 */
export async function recordRun(
	workspaceId: number,
	packId: string,
	lessonId: string,
	score: number,
	total: number
): Promise<Progress> {
	const answer = await api<unknown>(`/api/grammar/progress?workspace=${workspaceId}`, {
		method: 'POST',
		body: { packId, lessonId, score, total }
	});
	const progress = parseProgress(answer);
	if (progress === null) throw new Error('grammar: the server answered no progress');
	return progress;
}
