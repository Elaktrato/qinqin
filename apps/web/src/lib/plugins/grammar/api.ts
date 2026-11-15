import { ApiError, api } from '$lib/api/client';
import type { LessonView, PackInfo } from './types';

/** listGrammar queries GET /api/grammar: installed grammar packs, optionally of one language. */
export async function listGrammar(language?: string): Promise<PackInfo[]> {
	const query = language ? `?language=${encodeURIComponent(language)}` : '';
	const packs = await api<PackInfo[]>(`/api/grammar${query}`, { auth: false });
	return Array.isArray(packs) ? packs : [];
}

/** loadLesson queries one lesson; a lesson that does not exist (any more) is null. */
export async function loadLesson(pack: string, lesson: string): Promise<LessonView | null> {
	try {
		return await api<LessonView>(
			`/api/grammar/${encodeURIComponent(pack)}/${encodeURIComponent(lesson)}`,
			{ auth: false }
		);
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return null;
		throw err;
	}
}
