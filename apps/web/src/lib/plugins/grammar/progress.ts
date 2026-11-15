// Lesson progress as workspace-scoped plugin data of `qinqin-grammar`, read
// and written through the plugin SDK (the manifest declares owns-data).

import { createPluginSdk } from '../sdk';
import { grammarManifest } from './manifest';
import type { Progress } from './types';

export const GRAMMAR_PLUGIN_ID = grammarManifest.id;

const sdk = createPluginSdk(grammarManifest);

const PREFIX = 'lesson:';

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

/** loadProgress reads the workspace's lesson rows; malformed ones are skipped. */
export async function loadProgress(workspaceId: number): Promise<Map<string, Progress>> {
	const rows = await sdk.data.workspace(workspaceId).list(PREFIX);
	const out = new Map<string, Progress>();
	for (const row of rows) {
		const progress = parseProgress(row.data);
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
		// Scores of a lesson with a different number of exercises (a re-import,
		// a script conversion that dropped a cloze) are not comparable: start over.
		best: Math.max(score, previous && previous.total === total ? previous.best : 0),
		total
	};
	const key = progressKey(packId, lessonId);
	await sdk.data.workspace(workspaceId).put(key, next);
	return next;
}

/**
 * recordRun stores a finished run: it reads the stored row first and
 * keeps the best score. When that read fails nothing is written (a
 * lower score must never replace a better one); the error is thrown for
 * the caller to show and retry.
 */
export async function recordRun(
	workspaceId: number,
	packId: string,
	lessonId: string,
	score: number,
	total: number
): Promise<Progress> {
	const stored = await sdk.data.workspace(workspaceId).get(progressKey(packId, lessonId));
	return saveProgress(workspaceId, packId, lessonId, score, total, parseProgress(stored));
}
